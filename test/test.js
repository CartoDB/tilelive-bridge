'use strict';

var Bridge = require('..');
var path = require('path');
var fs = require('fs');
var mapnik = require('@carto/mapnik');
var zlib = require('zlib');
var tape = require('tape');
var UPDATE = process.env.UPDATE;
var deepEqual = require('deep-equal');
var mapnik_pool = require('mapnik-pool');
var mapnikPool = mapnik_pool(mapnik);

// Load fixture data.
var xml = {
    a: fs.readFileSync(path.resolve(path.join(__dirname,'/test-a.xml')), 'utf8'),
    b: fs.readFileSync(path.resolve(path.join(__dirname,'/test-b.xml')), 'utf8'),
    c: fs.readFileSync(path.resolve(path.join(__dirname,'/test-c.xml')), 'utf8'),
    itp: fs.readFileSync(path.resolve(path.join(__dirname,'/itp.xml')), 'utf8'),
    carmen_a: fs.readFileSync(path.resolve(path.join(__dirname,'/test-carmenprops-a.xml')), 'utf8')
};
var rasterxml = {
    a: fs.readFileSync(path.resolve(path.join(__dirname,'/raster-a.xml')), 'utf8'),
    b: fs.readFileSync(path.resolve(path.join(__dirname,'/raster-b.xml')), 'utf8'),
    c: fs.readFileSync(path.resolve(path.join(__dirname,'/raster-c.xml')), 'utf8')
};

(function() {
    tape('should set protocol as we would like', function(assert) {
        var fake_tilelive = {
            protocols: {}
        };
        Bridge.registerProtocols(fake_tilelive);
        assert.equal(fake_tilelive.protocols['bridge:'],Bridge);
        assert.end();
    });
    tape('should fail without xml', function(assert) {
        new Bridge({}, function(err) {
            assert.equal(err.message, 'No xml');
            assert.end();
        });
    });
    tape('should fail with invalid xml', function(assert) {
        new Bridge({xml: 'bogus'}, function (err, source) {
            source.getTile(0,0,0, function (err) {
                assert.equal(err.message, 'expected < at line 1');
                assert.end();
            });
        });
    });
    tape('should fail with invalid xml at map.acquire', function(assert) {
        new Bridge({xml: '<Map></Map>'}, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            // manually break the map pool to deviously trigger later error
            // this should never happen in reality but allows us to
            // cover this error case nevertheless
            source._map = mapnikPool.fromString('bogus xml');
            source.getTile(0,0,0, function(err, buffer, headers) {
                assert.equal(err.message, 'expected < at line 1');
                source.close(function() {
                    assert.end();
                });
            });
        });
    });
    tape('should fail with out of bounds x or y', function(assert) {
        new Bridge({ xml:xml.a, base:path.join(__dirname,'/') }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            source.getTile(0,0,1, function(err, buffer, headers) {
                assert.equal(err.message, 'required parameter y is out of range of possible values based on z value');
                assert.end();
            });
        });
    });
    tape('should load with callback', function(assert) {
        new Bridge({ xml: xml.a, base:path.join(__dirname,'/') }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            source.close(function() {
                assert.end();
            })
        });
    });
})();

function compare_vtiles(assert,filepath,vtile1,vtile2) {
    assert.equal(vtile1.tileSize,vtile2.tileSize);
    // assert.equal(vtile1.height(),vtile2.height());
    assert.deepEqual(vtile1.names(),vtile2.names());
    assert.deepEqual(vtile1.names(),vtile2.names());
    // assert.equal(vtile1.isSolid(),vtile2.isSolid());
    assert.equal(vtile1.empty(),vtile2.empty());
    var v1 = vtile1.toJSON();
    var v2 = vtile2.toJSON();
    assert.equal(v1.length,v2.length);
    var l1 = v1[0];
    var l2 = v2[0];
    assert.equal(l1.name,l2.name);
    assert.equal(l1.version,l2.version);
    assert.equal(l1.extent,l2.extent);
    assert.equal(l1.features.length,l2.features.length);
    assert.deepEqual(l1.features[0],l2.features[0]);
    if (!deepEqual(v1,v2)) {
        var e = filepath+'.expected.json';
        var a = filepath+'.actual.json';
        fs.writeFileSync(e,JSON.stringify(JSON.parse(vtile1.toGeoJSON('__all__')),null,2));
        fs.writeFileSync(a,JSON.stringify(JSON.parse(vtile2.toGeoJSON('__all__')),null,2));
        assert.ok(false,'files json representations differs: \n'+e + '\n' + a + '\n');
    }
}

(function() {
    var sources = {
        a: { xml:xml.a, base:path.join(__dirname,'/'), blank:true },
        b: { xml:xml.b, base:path.join(__dirname,'/') },
        c: { xml:xml.a, base:path.join(__dirname,'/'), blank:false }
    };
    var tests = {
        a: ['0.0.0', '1.0.0', '1.0.1', {key:'10.0.0',empty:true}, {key:'10.765.295'}],
        b: ['0.0.0'],
        c: [{key:'10.0.0',empty:true}, {key:'10.765.295'}]
    };
    Object.keys(tests).forEach(function(source) {
        tape('setup', function(assert) {
            sources[source] = new Bridge(sources[source], function(err) {
                assert.ifError(err);
                assert.end();
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tests[source].forEach(function(obj) {
            var key = obj.key ? obj.key : obj;
            var z = key.split('.')[0] | 0;
            var x = key.split('.')[1] | 0;
            var y = key.split('.')[2] | 0;
            tape('should render ' + source + ' (' + key + ')', function(assert) {
                sources[source].getTile(z,x,y, function(err, buffer, headers) {
                    // Test that empty tiles are so.
                    if (obj.empty) {
                        assert.equal(buffer.length, 0);
                        assert.equal(headers['x-tilelive-contains-data'], false);
                        return assert.end();
                    }

                    assert.ifError(err);
                    assert.equal(headers['Content-Type'], 'application/x-protobuf');
                    assert.equal(headers['Content-Encoding'], 'gzip');

                    // Test solid key generation.
                    if (obj.solid) assert.equal(buffer.solid, obj.solid);

                    zlib.gunzip(buffer, function(err, buffer) {
                        assert.ifError(err);

                        var filepath = path.join(__dirname,'/expected/' + source + '.' + key + '.vector.pbf');
                        if (UPDATE || !fs.existsSync(filepath)) fs.writeFileSync(filepath, buffer);

                        var expected = fs.readFileSync(filepath);
                        var vtile1 = new mapnik.VectorTile(+z,+x,+y);
                        var vtile2 = new mapnik.VectorTile(+z,+x,+y);
                        vtile1.setDataSync(expected);
                        vtile2.setDataSync(buffer);
                        compare_vtiles(assert,filepath,vtile1,vtile2);
                        assert.equal(expected.length, buffer.length);
                        assert.deepEqual(expected, buffer);
                        assert.end();
                    });
                });
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tape('teardown', function(assert) {
            var s = sources[source];
            assert.equal(1,s._map.getPoolSize());
            assert.equal(0,s._im.getPoolSize());
            s.close(function() {
                assert.equal(0,s._map.getPoolSize());
                assert.equal(0,s._im.getPoolSize());
                assert.end();
            });
        });
    });
})();

(function() {
    var sources = {
        a: { xml:rasterxml.a, base:path.join(__dirname,'/'), blank:true },
        b: { xml:rasterxml.b, base:path.join(__dirname,'/'), blank:true },
        c: { xml:rasterxml.c, base:path.join(__dirname,'/'), blank:false }
    };
    var tests = {
        a: ['0.0.0', '1.0.0', '2.1.1', '3.2.2', '4.3.3', '5.4.4'],
        b: ['0.0.0', '1.0.0'],
        c: ['0.0.0', '1.0.0']
    };
    Object.keys(tests).forEach(function(source) {
        tape('setup', function(assert) {
            sources[source] = new Bridge(sources[source], function(err) {
                assert.ifError(err);
                assert.end();
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tests[source].forEach(function(obj) {
            var key = obj.key ? obj.key : obj;
            var z = key.split('.')[0] | 0;
            var x = key.split('.')[1] | 0;
            var y = key.split('.')[2] | 0;
            tape('should render ' + source + ' (' + key + ')', function(assert) {
                sources[source].getTile(z,x,y, function(err, buffer, headers) {
                    // Test that empty tiles are so.
                    if (obj.empty) {
                        assert.equal(buffer.length, 0);
                        return assert.end();
                    }

                    assert.ifError(err);
                    assert.equal(headers['Content-Type'], 'image/webp');

                    // Test solid key generation.
                    if (obj.solid) assert.equal(buffer.solid, obj.solid);

                    var filepath = path.join(__dirname,'/expected-raster/' + source + '.' + key + '.webp');
                    if (UPDATE || !fs.existsSync(filepath)) {
                        console.log('Generating image at ' + filepath);
                        fs.writeFileSync(filepath, buffer);
                    }

                    var resultImage = new mapnik.Image.fromBytesSync(buffer);
                    var expectImage = new mapnik.Image.fromBytesSync(fs.readFileSync(filepath));
                    assert.equal(expectImage.compare(resultImage),0);
                    assert.end();
                });
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tape('teardown', function(assert) {
            var s = sources[source];
            assert.equal(1,s._map.getPoolSize());
            assert.equal(1,s._im.getPoolSize());
            s.close(function() {
                assert.equal(0,s._map.getPoolSize());
                assert.equal(0,s._im.getPoolSize());
                assert.end();
            });
        });
    });
})();

(function() {
    // Buffer-size configurable

    tape('should receive buffer-size parameter through URI', function(assert) {
        new Bridge({xml: '<Map></Map>', query:{bufferSize: 0}}, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal(source._bufferSize, 0);
            assert.end();
        });
    });

    tape('should set to default value if buffer-size passed through URI is not a positive numberj', function(assert) {
        new Bridge({xml: '<Map></Map>', query:{bufferSize: -1}}, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal(source._bufferSize, 256);
            assert.end();
        });
    });

    tape('should set to default value if buffer-size passed through URI is not a number', function(assert) {
        new Bridge({xml: '<Map></Map>', query:{bufferSize: 'aa'}}, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal(source._bufferSize, 256);
            assert.end();
        });
    });

    var sources = {
        a: { xml: xml.c, base: path.join(__dirname,'/'), query: {bufferSize: 0}},
        b: { xml: xml.c, base: path.join(__dirname,'/'), query: {bufferSize: 64}},
    };

    var tests = {
        a: [{ coords: '1.0.0', bufferSize: 0 }, { coords: '2.1.1', bufferSize: 0 }],
        b: [{ coords: '1.0.0', bufferSize: 64 }, { coords: '2.1.1', bufferSize: 64 }]
    };

    Object.keys(tests).forEach(function(source) {
        tape('setup', function(assert) {
            sources[source] = new Bridge(sources[source], function(err) {
                assert.ifError(err);
                assert.end();
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tests[source].forEach(function(test) {
            var coords = test.coords.split('.');
            var bufferSize = test.bufferSize;
            var z = coords[0];
            var x = coords[1];
            var y = coords[2];
            tape('should render ' + source + ' (' + test.coords + ') using buffer-size ' + bufferSize, function(assert) {
                sources[source].getTile(z,x,y, function(err, buffer, headers) {
                    assert.ifError(err);
                    assert.equal(headers['Content-Type'], 'application/x-protobuf');
                    assert.equal(headers['Content-Encoding'], 'gzip');

                    zlib.gunzip(buffer, function(err, buffer) {
                        assert.ifError(err);

                        var filepath = path.join(__dirname,'/expected/' + source + '.' + test.coords + '.vector.buffer-size.' + bufferSize + '.pbf');
                        if (UPDATE || !fs.existsSync(filepath)) fs.writeFileSync(filepath, buffer);
                        // fs.writeFileSync(filepath, buffer)

                        var expected = fs.readFileSync(filepath);
                        var vtile1 = new mapnik.VectorTile(+z,+x,+y,{buffer_size:16*test.bufferSize});
                        var vtile2 = new mapnik.VectorTile(+z,+x,+y,{buffer_size:16*test.bufferSize});
                        vtile1.setDataSync(expected);
                        vtile2.setDataSync(buffer);
                        compare_vtiles(assert, filepath, vtile1, vtile2);
                        assert.equal(expected.length, buffer.length);
                        assert.deepEqual(expected, buffer);
                        assert.end();
                    });
                });
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tape('teardown', function(assert) {
            var s = sources[source];
            assert.equal(1,s._map.getPoolSize());
            assert.equal(0,s._im.getPoolSize());
            s.close(function() {
                assert.equal(0,s._map.getPoolSize());
                assert.equal(0,s._im.getPoolSize());
                assert.end();
            });
        });
    });
})();

(function() {
    // limits: timeout configurable

    tape('should receive timeout parameter through URI', function (assert) {
        var uri = {
            xml: '<Map></Map>',
            query: {
                limits: {
                    render: 1
                }
            }
        }
        new Bridge(uri, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal(source._uri.limits.render, 1);
            assert.end();
        });
    });

    var sources = {
        a: {
            xml: xml.c,
            base: path.join(__dirname,'/'), query: {
                bufferSize: 64,
                limits: {
                    render: 1
                }
            }
        }
    };

    var tests = {
        a: [{ coords: '2.1.1', timeout: 1 }],
    };

    Object.keys(tests).forEach(function(source) {
        tape('setup', function(assert) {
            sources[source] = new Bridge(sources[source], function(err) {
                assert.ifError(err);
                assert.end();
            });
        });
    });
    Object.keys(tests).forEach(function (source) {
        tests[source].forEach(function (test) {
            var coords = test.coords.split('.');
            var timeout = test.timeout;
            var z = coords[0];
            var x = coords[1];
            var y = coords[2];
            tape('should timeout ' + source + ' (' + test.coords + ') using limits.render ' + timeout, function (assert) {
                sources[source].getTile(z,x,y, function(err, buffer, headers) {
                    assert.ok(err);
                    assert.equal(err.message, 'Render timed out');
                    assert.end();
                });
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tape('teardown', function(assert) {
            var s = sources[source];
            assert.equal(1,s._map.getPoolSize());
            assert.equal(0,s._im.getPoolSize());
            s.close(function() {
                assert.equal(0,s._map.getPoolSize());
                assert.equal(0,s._im.getPoolSize());
                assert.end();
            });
        });
    });
})();
