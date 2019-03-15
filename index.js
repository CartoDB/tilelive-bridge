'use strict';

const path = require('path');
const mapnik = require('@carto/mapnik');
const mapnik_pool = require('mapnik-pool');
const timeoutDecorator = require('./utils/timeout-decorator')

// Register datasource plugins
mapnik.register_default_input_plugins();

const mapnikPool = mapnik_pool(mapnik);

module.exports = Bridge;

function Bridge(uri, callback) {
    if (!uri.xml) {
        return callback(new Error('No xml'));
    }

    // whether to compress the vector tiles or not, true by default
    this._gzip = typeof uri.gzip === 'boolean' ? uri.gzip : true;

    uri.limits = (uri.query && uri.query.limits) ? uri.query.limits : {};

    if (typeof uri.limits.render === 'undefined') {
        uri.limits.render = 0;
    }

    if (uri.limits.render > 0) {
        const errorMsg = 'Render timed out';
        this.getTile = timeoutDecorator(this.getTile.bind(this), uri.limits.render, errorMsg);
    }

    // For currently unknown reasons map objects can currently be acquired
    // without being released under certain circumstances. When this occurs
    // a source cannot be closed fully during a copy or other operation. For
    // now error out in these scenarios as a close timeout.
    const errorMsgClose = 'Source resource pool drain timed out after 5s';
    this.close = timeoutDecorator(this.close.bind(this), 5000, errorMsgClose);

    const bufferSize = (uri.query && Number.isFinite(uri.query.bufferSize) && uri.query.bufferSize >= 0) ? uri.query.bufferSize : 256;
    const initOptions = { size: 256, bufferSize };
    const mapOptions = { strict: false, base: `${path.resolve(uri.base || __dirname)}/` };

    this._mapPool = mapnikPool.fromString(uri.xml, initOptions, mapOptions);

    return callback(null, this);
}

Bridge.registerProtocols = function(tilelive) {
    tilelive.protocols['bridge:'] = Bridge;
};

Bridge.prototype.close = function (callback) {
    this._mapPool.drain(() => this._mapPool.destroyAllNow(callback));
};

Bridge.prototype.getTile = function (z, x, y, callback) {
    this._mapPool.acquire((err, map) => {
        if (err) {
            return callback(err);
        }

        const options = {};

        let vtile;
        // The buffer size is in vector tile coordinates, while the buffer size on the
        // map object is in image coordinates. Therefore, lets multiply the buffer_size
        // by the old "path_multiplier" value of 16 to get a proper buffer size.
        try {
            // Try-catch is necessary here because the constructor will throw if x and y
            // are out of bounds at zoom-level z
            vtile = new mapnik.VectorTile(+z,+x,+y, { buffer_size: 16 * map.bufferSize });
        } catch(err) {
            return callback(err);
        }

        map.extent = vtile.extent();

        // Since we (CARTO) are already simplifying the geometries in the Postgresql query
        // we don't want another simplification as it will have a visual impact
        options.simplify_distance = 0;

        options.threading_mode = getThreadingMode(map);

        // enable strictly_simple
        options.strictly_simple = true;

        // make zoom, x, y and bbox variables available to mapnik postgis datasource
        options.variables = {
            zoom_level: z, // for backwards compatibility
            zoom: z,
            x: x,
            y: y,
            bbox: JSON.stringify(map.extent)
        };

        map.render(vtile, options, (err, vtile) => {
            this._mapPool.release(map);

            if (err) {
                return callback(err);
            }

            const headers = {};

            headers['Content-Type'] = 'application/x-protobuf';
            headers['x-tilelive-contains-data'] = vtile.painted();

            if (vtile.empty()) {
                return callback(null, new Buffer(0), headers);
            }

            vtile.getData({ compression: this._gzip ? 'gzip' : 'none' }, (err, pbfz) => {
                if (err) {
                    return callback(err);
                }

                if (this._gzip) {
                    headers['Content-Encoding'] = 'gzip';
                }

                return callback(err, pbfz, headers);
            });
        });
    });
};

// We (CARTO) are using always the default value: deferred = 2;
function getThreadingMode (map) {
    const threadingType = map.parameters.threading_mode;

    if (threadingType === 'auto') {
        return mapnik.threadingMode.auto; // 3
    }

    if (threadingType === 'async') {
        return mapnik.threadingMode.async; // 1
    }

    return mapnik.threadingMode.deferred; // 2
}
