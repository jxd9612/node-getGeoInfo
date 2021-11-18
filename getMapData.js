const fs = require('fs');
const axios = require('axios');

const KEY = '5e3614c89aca9456365d1e1b0795ec37';

class getMapData {
    constructor() {}

    async getData(url) {
        const data = await axios.get(url).then(res => res.data);
        return data.infocode === '10000' ? data.districts[0] : null;
    }

    async getBaseInfo(limit = 'city') {
        const URL = `http://restapi.amap.com/v3/config/district?key=${KEY}&subdistrict=3&extensions=base`;
        const districts = await this.getData(URL);
        if (districts) {
            const container = {};

            container['中国'] = {
                adcode: districts.adcode,
                level: districts.level,
                center: [Number(districts.center.split(',')[0]), Number(districts.center.split(',')[1])],
            };

            for (let province of districts.districts) {
                container[province.name] = {
                    adcode: province.adcode,
                    level: province.level,
                    center: [Number(province.center.split(',')[0]), Number(province.center.split(',')[1])],
                };

                if (limit === 'province') continue;

                for (let city of province.districts) {
                    container[city.name] = {
                        adcode: city.adcode,
                        level: city.level,
                        center: [Number(city.center.split(',')[0]), Number(city.center.split(',')[1])],
                    };

                    if (limit === 'city') continue;

                    for (let district of city.districts) {
                        container[district.name] = {
                            adcode: district.adcode,
                            level: district.level,
                            center: [Number(district.center.split(',')[0]), Number(district.center.split(',')[1])],
                        };
                    }
                }
            }

            this.saveFile('json/base-info.json', container);
        } else {
            console.log('数据返回失败，请检查KEY是否有效');
        }
    }

    async getGeoJson(adcode = '100000') {
        const ROOT_URL = `http://restapi.amap.com/v3/config/district?key=${KEY}&subdistrict=1&extensions=base&keywords=${adcode}`;
        const NODE_URL = `http://restapi.amap.com/v3/config/district?key=${KEY}&subdistrict=0&extensions=all&keywords=`;
        const district = await this.getData(ROOT_URL);

        if (district) {
            console.log(`开始处理[${district.name}]的行政边界数据`);
            const geo = {};
            geo.type = 'FeatureCollection';
            const features = [];
            for (let child of district.districts) {
                if (adcode !== child.adcode) {
                    const childDistrict = await this.getData(`${NODE_URL}${child.adcode}`);
                    console.log(`开始处理[${childDistrict.name}]的行政边界数据`);
                    features.push(this.parseToFeature(childDistrict));
                }
            }

            geo.features = features;

            if (!geo.UTF8Encoding) {
                let encodeScale = geo.UTF8Scale;
                if (encodeScale === null) encodeScale = 1024;
                let features = geo.features;
                for (let f = 0; f < features.length; f++) {
                    let feature = features[f];
                    let geometry = feature.geometry;
                    let coordinates = geometry.coordinates;
                    feature.properties.childNum = coordinates.length;
                    geometry.encodeOffsets = [];
                    let encodeOffsets = geometry.encodeOffsets;
                    for (let c = 0; c < coordinates.length; c++) {
                        let coordinate = coordinates[c];

                        if (geometry.type === 'Polygon') {
                            const encodeCoordinate = this.encodePolygon(coordinate, encodeScale);
                            coordinates[c] = encodeCoordinate.coordinate;
                            encodeOffsets[c] = encodeCoordinate.encodeOffsets;
                        } else if (geometry.type === 'MultiPolygon') {
                            for (let c2 = 0; c2 < coordinate.length; c2++) {
                                let polygon = coordinate[c2];
                                encodeOffsets[c] = [];
                                const encodeCoordinate = this.encodePolygon(polygon, encodeScale);
                                coordinate[c2] = encodeCoordinate.coordinate;
                                encodeOffsets[c][c2] = encodeCoordinate.encodeOffsets;
                            }
                        }
                    }
                }
                geo.UTF8Encoding = true;
            }

            this.saveFile(`json/${adcode}.json`, geo);

            for (let child of district.districts) {
                if (adcode != child.adcode && child.adcode % 100 === 0) {
                    await this.getGeoJson(child.adcode);
                }
            }
        } else {
            console.log('数据返回失败，请检查KEY是否有效');
        }
    }

    encodePolygon(coordinate, encodeScale) {
        let coordinateStr = '';
        for (let i = coordinate.length - 1; i > 0; i--) {
            let x = coordinate[i][0];
            let y = coordinate[i][1];
            x = x * encodeScale;
            y = y * encodeScale;
            x -= coordinate[i - 1][0] * encodeScale;
            y -= coordinate[i - 1][1] * encodeScale;
            x = (x << 1) ^ (x >> 31);
            y = (y << 1) ^ (y >> 31);
            coordinateStr = String.fromCharCode(x + 64) + String.fromCharCode(y + 64) + coordinateStr;
        }
        coordinateStr = '@@' + coordinateStr;
        let encodeOffsets = [coordinate[0][0] * encodeScale, coordinate[0][1] * encodeScale];
        return { coordinate: coordinateStr, encodeOffsets: encodeOffsets, encodeScale: encodeScale };
    }

    parseToFeature(district) {
        let feature = {};
        feature.id = district.adcode;
        feature.type = 'Feature';
        feature.properties = {};
        feature.properties.name = district.name;
        feature.properties.cp = district.center.split(',').map(item => Number(item));

        let polylines = district.polyline.split('|');
        let coordinates = [];
        let coordinateGroups = polylines.map(polyline => polyline.split(';').map(pointStr => pointStr.split(',').map(item => Math.floor(item * 1024) / 1024)));
        if (coordinateGroups.length > 1) {
            coordinateGroups.forEach(item => {
                coordinates.push([item]);
            });
        } else {
            coordinateGroups.forEach(item => {
                coordinates.push(item);
            });
        }
        feature.geometry = {};
        feature.geometry.type = coordinateGroups.length > 1 ? 'MultiPolygon' : 'Polygon';
        feature.geometry.coordinates = coordinates;

        return feature;
    }

    saveFile(path, data, folder = 'json') {
        fs.stat(folder, (err, stats) => {
            if (!stats) fs.mkdirSync(folder);

            fs.writeFile(path, JSON.stringify(data), err => {
                if (err) {
                    console.log(err, '文件保存失败');
                    return;
                }
                console.log(`文件保存成功`);
            });
        });
    }
}

module.exports = new getMapData();
