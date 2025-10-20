const xml = require('xml2js');
const path = require('path');
const express = require('express');


function init(app, server) {
    const machineRoutes = require('../controllers/machine')(server);
    const itemRoutes = require('../controllers/item')(server);
    const operatorRoutes = require('../controllers/operator')(server);
    const statusRoutes = require('../controllers/status')(server);
    const softrolRoutes = require('../controllers/softrol')(server);
    const alphaRoutes = require('../controllers/alpha')(server);
    const authRoutes = require('../controllers/auth')(server);
    const passportRoutes = require('../controllers/passport')(server);
    const historyRoutes = require('../controllers/history')(server);
    const utilitiesRoutes = require('../controllers/utilities')(server);


    app.get('/docs/api', (req, res, next) => {
        res.sendFile(path.join(server.appRoot.path, '/docs/api.html'));
    });

    app.get('/docs/cd/readme', (req, res, next) => {
        res.sendFile(path.join(server.appRoot.path, '/docs/cd/readme.html'));
    });

    function xmlArrayBuilder(rootLabel, array, excludeHeader, callback) {
        let arrayBuilder = new xml.Builder({ renderOpts: { 'pretty': false }, headless: true, rootName: rootLabel });
        let returnString;
        if (excludeHeader) {
            returnString = '<' + rootLabel + 's>';
        } else {
            returnString = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><' + rootLabel + 's>';
        }

        array.forEach((element) => {
            returnString += arrayBuilder.buildObject(element);
        });
        returnString += '</' + rootLabel + 's>'
        if (callback) {
            return callback(returnString);
        } else {
            return returnString;
        }
    }

    function xmlMachineStateBuilder(machineObject, callback) {
        machineObject.machine['id'] = machineObject.ID;
        machineObject.machine['name'] = machineObject.MachineName;
        machineObject.machine['lanes'] = machineObject.Lanes;
        delete machineObject.ID;
        delete machineObject.SerialNumb;
        delete machineObject.MachineName;
        delete machineObject.Active;
        delete machineObject.DateAdded;
        delete machineObject.IPAddress;
        delete machineObject.Lanes;
        delete machineObject.timestamp;

        //Deep copy the object arrays for separate parsing
        let lpOperators = machineObject.lpOperators.map((x) => x);
        let spOperators = machineObject.spOperators.map((x) => x);
        let items = machineObject.items.map((x) => x);
        let itemInfo = machineObject.itemInfo.map((x) => x);
        let lpOperatorInfo = machineObject.lpOperatorInfo.map((x) => x);
        let spOperatorInfo = machineObject.spOperatorInfo.map((x) => x);
        let statusInfo = machineObject.statusInfo.map((x) => x);

        //Delete the arrays from the object so we can parse the main object easily
        delete machineObject.lpOperators;
        delete machineObject.spOperators;
        delete machineObject.items;
        delete machineObject.itemInfo;
        delete machineObject.lpOperatorInfo;
        delete machineObject.spOperatorInfo;
        delete machineObject.statusInfo;

        let machineBuilder = new xml.Builder({ renderOpts: { 'pretty': false }, rootName: 'machineState' });
        let xmlString = machineBuilder.buildObject(machineObject);
        return callback(xmlString);
    }

    app.get('/api/machine/levelone/multilaneDemo/xml', (req, res, next) => {
        res.set('Content-Type', 'text/xml');

        let machineJSON = {
            'fault': {
                'code': 3,
                'name': 'Stop'
            }
        };

        let lanesJSON = [{
            'operator': {
                'id': null,
                'name': 'None Entered'
            },
            'task': {
                'id': 24,
                'name': 'BarMop'
            },
            'pace': {
                'standard': 1380,
                'current': 0
            },
            'timeOnTask': 0,
            'totalCount': 0,
            'efficiency': 0,
        }, {
            'operator': {
                'id': null,
                'name': 'None Entered'
            },
            'task': {
                'id': 24,
                'name': 'BarMop'
            },
            'pace': {
                'standard': 1380,
                'current': 0
            },
            'timeOnTask': 0,
            'totalCount': 0,
            'efficiency': 0,
        }, {
            'operator': {
                'id': null,
                'name': 'None Entered'
            },
            'task': {
                'id': 24,
                'name': 'BarMop'
            },
            'pace': {
                'standard': 1380,
                'current': 0
            },
            'timeOnTask': 0,
            'totalCount': 0,
            'efficiency': 0,
        }, {
            'operator': {
                'id': null,
                'name': 'None Entered'
            },
            'task': {
                'id': 24,
                'name': 'BarMop'
            },
            'pace': {
                'standard': 1380,
                'current': 0
            },
            'timeOnTask': 0,
            'totalCount': 0,
            'efficiency': 0,
        }];



        let levelOneBuilder = new xml.Builder({ renderOpts: { 'pretty': false }, rootName: 'levelOne' });
        let xmlString = levelOneBuilder.buildObject(machineJSON);
        let splitArray = xmlString.split('</levelOne>');
        xmlString = splitArray[0];
        xmlString += xmlArrayBuilder('lane', lanesJSON, true);
        xmlString += '</levelOne>';

        res.send(xmlString);
    });

    app.get('/api/machine/levelone/:serialNumber/xml', (req, res, next) => {
        res.set('Content-Type', 'text/xml');

        let jsonPackage = {
            'operator': {
                'id': null,
                'name': 'None Entered'
            },
            'task': {
                'id': 24,
                'name': 'BarMop'
            },
            'pace': {
                'standard': 1380,
                'current': 0
            },
            'timeOnTask': 0,
            'totalCount': 0,
            'efficiency': 0,
            'fault': {
                'code': 3,
                'name': 'Stop'
            }
        };

        let levelOneBuilder = new xml.Builder({ renderOpts: { 'pretty': false }, rootName: 'levelOne' });
        let xmlString = levelOneBuilder.buildObject(jsonPackage);

        res.send(xmlString);
    });

    app.get('/api/machine/leveltwo/:serialNumber/xml', (req, res, next) => {
        res.set('Content-Type', 'text/xml');

        let jsonPackage = {
            'timers': {
                'run': 63,
                'down': 0,
                'total': 63
            },
            'programNumber': 2,
            'item': {
                'id': 1,
                'name': 'Incontinent Pad',
            },
            'currentStats': {
                'pace': 640,
                'count': 284
            },
            'totals': {
                'in': 2493,
                'out': 2384,
                'thru': 95.63,
                'faults': 3,
                'jams': 14
            },
            'availability': 86.55,
            'oee': 68.47,
            'operatorEfficiency': 68.47
        };

        let levelTwoBuilder = new xml.Builder({ renderOpts: { 'pretty': false }, rootName: 'levelTwo' });
        let xmlString = levelTwoBuilder.buildObject(jsonPackage);

        res.send(xmlString);
    });

    app.use('/api/alpha', alphaRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/passport', passportRoutes);

    app.use('/api/softrol', softrolRoutes);

    app.use('/api/history', historyRoutes);
    
    app.use('/api/utilities', utilitiesRoutes);

    app.use('/fonts/normal', express.static(path.join(server.appRoot.path, 'fonts/Montserrat-VariableFont_wght.ttf')));
    app.use('/fonts/bold', express.static(path.join(server.appRoot.path, 'fonts/Montserrat-VariableFont_wght.ttf')));
    app.use('/icons', express.static(path.join(server.appRoot.path, 'icons/MaterialSymbolsOutlined_Filled-Regular.ttf')));
    app.use(['/ng/*', '/'], express.static(path.join(server.appRoot.path, 'ng/browser/')));
    

    app.use('/api', machineRoutes);
    app.use('/api', itemRoutes);
    app.use('/api', operatorRoutes);
    app.use('/api', statusRoutes);


    function sendFlashJSON(req, res) {
        var json = {
            messages: req.flash('messages')
        };
        res.json(json);
    };

    // route middleware to make sure a user is logged in
    function isLoggedIn(req, res, next) {

        // if user is authenticated in the session, carry on
        if (req.isAuthenticated())
            return next()

        req.flash('messages', 'You are not authorized to access ' + req.path + '. Please log in first')
        return sendFlashJSON(req, res);
        //res.sendFile(path.join(server.appRoot.path, '/docs/api.html'));

    }


    const errorHandler = (error, request, response, next) => {
        server.logger.error(error);
        const status = error.status || 400
        // send back an easily understandable error message to the caller
        response.status(status).send(error.message)
    }

    app.use(errorHandler);
}

module.exports = {
    init: init
}