# CARTO tilelive-bridge changelog

## 2.5.1-cdb10
 - Update or remove dev dependencies.
 - **Remove error on empty tile**. Instead an empty buffer is returned. For MVTs the `x-tilelive-contains-data` header will still be set to false.
 - Update @carto/mapnik to [`3.6.2-carto.11`](https://github.com/CartoDB/node-mapnik/blob/v3.6.2-carto.11/CHANGELOG.carto.md#362-carto11). Includes a change in mapnik-vector-tile to simplify based on layer extent.

## 2.5.1-cdb9
 - Set @carto/mapnik to [`3.6.2-carto.10`](https://github.com/CartoDB/node-mapnik/blob/v3.6.2-carto/CHANGELOG.carto.md#362-carto10)

## 2.5.1-cdb8
 - Set @carto/mapnik to [`3.6.2-carto.9`](https://github.com/CartoDB/node-mapnik/blob/v3.6.2-carto/CHANGELOG.carto.md#362-carto9)
 - Force simplify_distance to 0 (Not needed since we already simplify geometries in the query)

## 2.5.1-cdb7
 - Set @carto/mapnik to [`3.6.2-carto.8`](https://github.com/CartoDB/node-mapnik/blob/v3.6.2-carto/CHANGELOG.carto.md#362-carto8)

## 2.5.1-cdb6
 - Set @carto/mapnik to [`3.6.2-carto.7`](https://github.com/CartoDB/node-mapnik/blob/v3.6.2-carto/CHANGELOG.carto.md#362-carto7)

## 2.5.1-cdb5
 - Set @carto/mapnik to [`3.6.2-carto.6`](https://github.com/CartoDB/node-mapnik/blob/v3.6.2-carto/CHANGELOG.carto.md#362-carto6)


## 2.5.1-cdb4
 - Set @carto/mapnik to `3.6.2-carto.4`, which includes improvements for the cache for raster symbols. See the [changelog](https://github.com/CartoDB/node-mapnik/blob/v3.6.2-carto/CHANGELOG.carto.md#362-carto4)

## 2.5.1-cdb3
 - Revert module updates from 2.5.1-cdb2
 - Set @carto/mapnik to `3.6.2-carto.2`

## 2.5.1-cdb2
 - Update @carto/node-mapnik to `3.6.2-carto.3`
 - Update @mapbox/sphericalmercator to `1.0.5`
 - Update coveralls to `3.0.0`
 - Change queue-async for d3-queue `3.0.7`
 - Update deep-equal to `1.0.1`
 - Update eslint to `4.18.1`
 - Update istambul to `0.4.5`
 - Update tape to `4.9.0`
 - Point CI badges to our fork

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
