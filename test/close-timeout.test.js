'use strict';

var Bridge = require('../lib');
var path = require('path');
var fs = require('fs');
var tape = require('tape');

tape('should timeout on close', function(assert) {
    var xml = fs.readFileSync(path.resolve(path.join(__dirname,'/test-a.xml')), 'utf8');
    new Bridge({ xml: xml, base:path.join(__dirname,'/') }, function(err, source) {
        assert.ifError(err);
        assert.ok(source);

        source._mapPool.acquire(function(err, map) {
            assert.ifError(err);
            assert.ok(map, 'acquires map');
        });

        source.close(function (err) {
            assert.equal(err.message, 'Source resource pool drain timed out after 5s');
            assert.end();
        });
    });
});
