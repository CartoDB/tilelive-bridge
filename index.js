'use strict';

var path = require('path');
var mapnik = require('@carto/mapnik');
var mapnik_pool = require('mapnik-pool');
var timeoutDecorator = require('./utils/timeout-decorator')

// Register datasource plugins
mapnik.register_default_input_plugins();

var mapnikPool = mapnik_pool(mapnik);

module.exports = Bridge;

function Bridge(uri, callback) {
    if (!uri.xml) {
        return callback(new Error('No xml'));
    }

    this._uri = uri;
    this._base = path.resolve(uri.base || __dirname);

    // 'blank' option forces all solid tiles to be interpreted as blank.
    this._blank = typeof uri.blank === 'boolean' ? uri.blank : false;

    // whether to compress the vector tiles or not
    this._gzip = typeof uri.gzip === 'boolean' ? uri.gzip : true;

    this._bufferSize = (uri.query && Number.isFinite(uri.query.bufferSize) && uri.query.bufferSize >= 0) ? uri.query.bufferSize : 256;

    this._uri.limits = (uri.query && uri.query.limits) ? uri.query.limits : {};
    if (typeof this._uri.limits.render === 'undefined') this._uri.limits.render = 0;

    if (this._uri.limits.render > 0) {
        this.getTile = timeoutDecorator(this.getTile.bind(this), this._uri.limits.render);
    }

    // Unset maxzoom. Will be re-set on first getTile.
    this._maxzoom = undefined;
    this._xml = uri.xml;

    var mopts = { strict: false, base: this._base + '/' };

    this._map = mapnikPool.fromString(this._xml, { size: 256, bufferSize: this._bufferSize }, mopts);

    return callback(null, this);
}

Bridge.registerProtocols = function(tilelive) {
    tilelive.protocols['bridge:'] = Bridge;
};

function poolDrain(pool,callback) {
    if (!pool) {
        return callback();
    }
    pool.drain(function() {
        pool.destroyAllNow(callback);
    });
}

Bridge.prototype.close = function(callback) {
    // For currently unknown reasons map objects can currently be acquired
    // without being released under certain circumstances. When this occurs
    // a source cannot be closed fully during a copy or other operation. For
    // now error out in these scenarios as a close timeout.
    setTimeout(function() {
        if (!callback) return;
        console.warn(new Error('Source resource pool drain timed out after 5s'));
        callback();
        callback = false;
    }, 5000);

    poolDrain(this._map, () => {
        if (!callback) return;
        callback();
        callback = false;
    });
};

Bridge.prototype.getTile = function (z, x, y, callback) {
    if (!this._map) {
        return callback(new Error('Tilesource not loaded'));
    }

    this._map.acquire((err, map) => {
        if (err) {
            return callback(err);
        }

        // set _maxzoom cache to prevent repeat calls to map.parameters
        if (this._maxzoom === undefined) {
            this._maxzoom = map.parameters.maxzoom ? parseInt(map.parameters.maxzoom, 10) : 14;
        }

        if (this._threading_mode === undefined) {
            var threading_type = map.parameters.threading_mode;
            if (threading_type === 'auto') {
                this._threading_mode = mapnik.threadingMode.auto;
            } else if (threading_type === 'async') {
                this._threading_mode = mapnik.threadingMode.async;
            } else {
                this._threading_mode = mapnik.threadingMode.deferred;
            }
        }

        this.getVector(map, z, x, y, callback);
    });
};

Bridge.prototype.getVector = function (map, z, x, y, callback) {
    var opts = {};

    var headers = {};
    headers['Content-Type'] = 'application/x-protobuf';

    // The buffer size is in vector tile coordinates, while the buffer size on the
    // map object is in image coordinates. Therefore, lets multiply the buffer_size
    // by the old "path_multiplier" value of 16 to get a proper buffer size.
    try {
        // Try-catch is necessary here because the constructor will throw if x and y
        // are out of bounds at zoom-level z
        var vtile = new mapnik.VectorTile(+z,+x,+y, {buffer_size:16*map.bufferSize});
    } catch(err) {
        return callback(err, null, headers);
    }

    map.extent = vtile.extent();

    // Since we (CARTO) are already simplifying the geometries in the Postgresql query
    // we don't want another simplification as it will have a visual impact
    opts.simplify_distance = 0;

    opts.threading_mode = this._threading_mode;

    // enable strictly_simple
    opts.strictly_simple = true;

    // make zoom, x, y and bbox variables available to mapnik postgis datasource
    opts.variables = {
        zoom_level: z, // for backwards compatibility
        zoom: z,
        x: x,
        y: y,
        bbox: JSON.stringify(map.extent)
    };

    map.render(vtile, opts, (err, vtile) => {
        this._map.release(map);
        if (err) {
            return callback(err);
        }
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
};
