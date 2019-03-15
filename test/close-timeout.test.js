'use strict';

var Bridge = require('..');
var path = require('path');
var fs = require('fs');
var tape = require('tape');

tape('should timeout on close', function(assert) {
    var xml = fs.readFileSync(path.resolve(path.join(__dirname,'/test-a.xml')), 'utf8');
    new Bridge({ xml: xml, base:path.join(__dirname,'/') }, function(err, source) {
        assert.ifError(err);
        assert.ok(source);

        var map;
        source._map.acquire(function(err, m) {
            assert.ifError(err);
            assert.ok(m, 'acquires map');
            map = m;
        });

        source.close(function (err) {
            assert.equal(err.message, 'Source resource pool drain timed out after 5s');
            // release map so node process ends
            source._map.release(map);

            assert.end();
        });
    });
});
