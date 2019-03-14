'use strict';

var url = require('url');
var path = require('path');
var mapnik = require('@carto/mapnik');
var fs = require('fs');
var qs = require('querystring');
var sm = new (require('@mapbox/sphericalmercator'))();
var mapnik_pool = require('mapnik-pool');
var Pool = mapnik_pool.Pool;
var os = require('os');
var timeoutDecorator = require('./utils/timeout-decorator')

// Register datasource plugins
mapnik.register_default_input_plugins();

// this will run on require, which means downstream users that are registering plugins
// and include this environment variable will hit this section even if it is not desired
if (process.env.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED) {
    var stats = { max:0, total:0, count:0 };
    process.on('exit', function() {
        stats.avg = stats.total/stats.count;
        if (stats.count > 0) {
            fs.writeFileSync('tilelive-bridge-stats.json', JSON.stringify(stats));
        }
    });
}


var mapnikPool = mapnik_pool(mapnik);

var ImagePool = function(size) {
    return Pool({
        create: create,
        destroy: destroy,
        max: os.cpus().length * 2
    });
    function create(callback) {
        return callback(null,new mapnik.Image(size,size));
    }
    function destroy(im) {
        // see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Delete_in_strict_mode
        im = null;
    }
}

module.exports = Bridge;

function Bridge(uri, callback) {
    this.BRIDGE_MAX_VTILE_BYTES_COMPRESSED = process.env.BRIDGE_MAX_VTILE_BYTES_COMPRESSED ? +process.env.BRIDGE_MAX_VTILE_BYTES_COMPRESSED : 0;
    this.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED = process.env.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED ? +process.env.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED : 0;
    var source = this;

    if (typeof uri === 'string' || (uri.protocol && !uri.xml)) {
        uri = typeof uri === 'string' ? url.parse(uri) : uri;
        uri.query = typeof uri.query === 'string' ? qs.parse(uri.query) : (uri.query || {});
        var filepath = path.resolve(uri.pathname);
        fs.readFile(filepath, 'utf8', function(err, xml) {
            if (err) {
                return callback(err);
            }
            var opts = Object.keys(uri.query).reduce(function(memo, key) {
                memo[key] = !!parseInt(uri.query[key], 10);
                return memo;
            }, {xml:xml, base:path.dirname(filepath)});
            init(source, opts, callback);
        });
        return source;
    } else {
        init(source, uri, callback);
        return source;
    }
}
require('util').inherits(Bridge, require('events').EventEmitter);

function init(source, uri, callback) {
    if (!uri.xml) {
        return callback && callback(new Error('No xml'));
    }

    source._uri = uri;
    source._base = path.resolve(uri.base || __dirname);

    // 'blank' option forces all solid tiles to be interpreted as blank.
    source._blank = typeof uri.blank === 'boolean' ? uri.blank : false;

    // whether to compress the vector tiles or not
    source._gzip = typeof uri.gzip === 'boolean' ? uri.gzip : true;

    source._bufferSize = (uri.query && Number.isFinite(uri.query.bufferSize) && uri.query.bufferSize >= 0) ? uri.query.bufferSize : 256;

    source._uri.limits = (uri.query && uri.query.limits) ? uri.query.limits : {};
    if (typeof source._uri.limits.render === 'undefined') source._uri.limits.render = 0;

    if (source._uri.limits.render > 0) {
        source.getTile = timeoutDecorator(source.getTile.bind(source), source._uri.limits.render);
    }

    if (callback) source.once('open', callback);

    source.update(uri, function(err) {
        source.emit('open', err, source);
    });
}


Bridge.registerProtocols = function(tilelive) {
    tilelive.protocols['bridge:'] = Bridge;
};

// Helper for callers to ensure source is open. This is not built directly
// into the constructor because there is no good auto cache-keying system
// for these tile sources (ie. sharing/caching is best left to the caller).
Bridge.prototype.open = function(callback) {
    if (this._map) {
        return callback(null, this);
    }
    this.once('open', callback);
};

// Allows in-place update of XML/backends.
Bridge.prototype.update = function(opts, callback) {
    // Unset maxzoom. Will be re-set on first getTile.
    this._maxzoom = undefined;
    // Unset type. Will be re-set on first getTile.
    this._type = undefined;
    this._xml = opts.xml;
    this._readonly_map = new mapnik.Map(1,1);
    var mopts = { strict: false, base: this._base + '/' };
    this._readonly_map.fromString(this._xml,mopts,function(err) {
        if (err) {
            return callback(err);
        }
        this.close(function() {
            this._map = mapnikPool.fromString(this._xml,
                { size: 256, bufferSize: this._bufferSize },
                mopts);
            this._im = ImagePool(512);
            return callback();
        }.bind(this));
    }.bind(this));
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
    poolDrain(this._map,function() {
        poolDrain(this._im,function() {
            if (!callback) return;
            callback();
            callback = false;
        });
    }.bind(this));
};

Bridge.prototype.getTile = function(z, x, y, callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));

    var source = this;
    source._map.acquire(function(err, map) {
        if (err) {
            return callback(err);
        }

        // set source _maxzoom cache to prevent repeat calls to map.parameters
        if (source._maxzoom === undefined) {
            source._maxzoom = map.parameters.maxzoom ? parseInt(map.parameters.maxzoom, 10) : 14;
        }

        // set source _type cache to prevent repeat calls to map layers
        if (source._type === undefined) {
            var layers = map.layers();
            if (layers.length && layers.some(function(l) { return l.datasource.type === 'raster' })) {
                source._type = 'raster';
            } else {
                source._type = 'vector';
            }
        }

        if (source._threading_mode === undefined) {
            var threading_type = map.parameters.threading_mode;
            if (threading_type === 'auto') {
                source._threading_mode = mapnik.threadingMode.auto;
            } else if (threading_type === 'async') {
                source._threading_mode = mapnik.threadingMode.async;
            } else {
                source._threading_mode = mapnik.threadingMode.deferred;
            }
        }

        if (source._type === 'raster') {
            source._im.acquire(function(err, im) {
                Bridge.getRaster(source, map, im, z, x, y, function(err,buffer,headers) {
                    source._im.release(im);
                    return callback(err,buffer,headers);
                });
            });
        } else {
            Bridge.getVector(source, map, z, x, y, callback);
        }
    });
};

Bridge.getRaster = function(source, map, im, z, x, y, callback) {
    map.bufferSize = 0;
    map.resize(512,512);
    map.extent = sm.bbox(+x,+y,+z, false, '900913');
    im.clear();
    map.render(im, function(err, image) {
        source._map.release(map);
        if (err) {
            return callback(err);
        }
        image.isSolid(function(err, solid, pixel) {
            if (err) {
                return callback(err);
            }

            // If source is in blank mode any solid tile is empty.
            if (solid && source._blank) {
                return callback(null, new Buffer(0));
            }

            var pixel_key = '';
            if (solid) {
                var a = (pixel>>>24) & 0xff;
                var r = pixel & 0xff;
                var g = (pixel>>>8) & 0xff;
                var b = (pixel>>>16) & 0xff;
                pixel_key = r +','+ g + ',' + b + ',' + a;
            }

            image.encode('webp', {}, function(err, buffer) {
                if (err) {
                    return callback(err);
                }
                buffer.solid = pixel_key;
                return callback(err, buffer, {'Content-Type':'image/webp'});
            });
        });
    });
};

Bridge.getVector = function(source, map, z, x, y, callback) {
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

    opts.threading_mode = source._threading_mode;

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

    map.render(vtile, opts, function(err, vtile) {
        source._map.release(map);
        if (err) {
            return callback(err);
        }
        headers['x-tilelive-contains-data'] = vtile.painted();
        if (vtile.empty()) {
            return callback(null, new Buffer(0), headers);
        }
        vtile.getData({ compression: source._gzip ? 'gzip' : 'none' }, function(err, pbfz) {
            if (err) {
                return callback(err);
            }

            if (source._gzip) {
                headers['Content-Encoding'] = 'gzip';
            }

            if (source.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED > 0 && pbfz.length > source.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED) {
                stats.count++;
                stats.total = stats.total + (pbfz.length*0.001);
                if (stats.max < pbfz.length) {
                    stats.max = pbfz.length;
                }
            }
            if (source.BRIDGE_MAX_VTILE_BYTES_COMPRESSED > 0 && pbfz.length > source.BRIDGE_MAX_VTILE_BYTES_COMPRESSED) {
                return callback(new Error("Tile >= max allowed size"), pbfz, headers);
            }
            return callback(err, pbfz, headers);
        });
    });
};

Bridge.prototype.getInfo = function(callback) {
    var map = this._readonly_map;
    if (!map) {
        return callback(new Error('Tilesource not loaded'));
    }

    var params = map.parameters;
    var info = Object.keys(params).reduce(function(memo, key) {
        switch (key) {
        // The special 'json' key/value pair allows JSON to be serialized
        // and merged into the metadata of a mapnik XML based source. This
        // enables nested properties and non-string datatypes to be
        // captured by mapnik XML.
        case 'json':
            try {
                var jsondata = JSON.parse(params[key]);
                Object.keys(jsondata).reduce(function(memo, key) {
                    memo[key] = memo[key] || jsondata[key];
                    return memo;
                }, memo);
            }
            catch (err) { return callback(err); }
            break;
        case 'bounds':
        case 'center':
            memo[key] = params[key].split(',').map(function(v) { return parseFloat(v) });
            break;
        default:
            memo[key] = params[key];
            break;
        }
        return memo;
    }, {});

    // Set an intelligent default for geocoder_shardlevel if not set.
    if (info.geocoder_layer && !('geocoder_shardlevel' in info)) {
        if (info.maxzoom > 12) {
            info.geocoder_shardlevel = 3;
        } else if (info.maxzoom > 8) {
            info.geocoder_shardlevel = 2;
        } else if (info.maxzoom > 6) {
            info.geocoder_shardlevel = 1;
        } else {
            info.geocoder_shardlevel = 0;
        }
    }
    return callback(null, info);
};
