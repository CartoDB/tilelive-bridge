# CARTO tilelive-bridge changelog

## 2.5.1-cdb2
 - Update @carto/node-mapnik to `3.6.2-carto.3`
 - Update @mapbox/sphericalmercator to `1.0.5`
 - Update coveralls to `3.0.0`
 - Change queue-async for d3-queue `3.0.7`
 - Update deep-equal to `1.0.1`
 - Update eslint to `4.18.1`
 - Update istambul to `0.4.5`
 - Update tape to `4.9.0`

## 2.5.1-cdb1

 - Codebase updated with upstream v2.5.1
 - Update dependencies to use node-mapnik @carto/mapnik ~3.6.2-carto.x
 - Allow substitution of zoom, x, y and bbox variables. See [820f40f](https://github.com/CartoDB/tilelive-bridge/pull/7/commits/820f40fcc7d79e1e70fe72dfec9a1501a1d277be)
 - Package namespace changed to @carto

## 2.3.1-cdb4

 - Do not wait for tile fetching after timeout fires

## 2.3.1-cdb3

 - Do not set encoding header if compression was not required


## 2.3.1-cdb2

 - Be able to configure buffer size from uri
