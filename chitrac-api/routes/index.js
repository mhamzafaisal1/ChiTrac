const path = require('path');
const express = require('express');


function init(app, server) {
    const machineRoutes = require('../controllers/machine')(server);
    const itemRoutes = require('../controllers/item')(server);
    const operatorRoutes = require('../controllers/operator')(server);
    const statusRoutes = require('../controllers/status')(server);
    const softrolRoutes = require('../controllers/softrol')(server);
    const alphaController = require('../controllers/alpha');
    const alphaRoutes = alphaController(server);
    alphaController.registerMachineXmlRoutes(app, server);
    const bikoRoutes = require('../controllers/biko')(server);
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

    // Conditionally load Softrol documentation based on environment setting
    if (server.config.softrol) {
        app.get('/docs/api/softrol', (req, res, next) => {
            res.sendFile(path.join(server.appRoot.path, '/docs/api-softrol.html'));
        });
    }

    app.use('/api/alpha', alphaRoutes);
    app.use('/api/biko', bikoRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/passport', passportRoutes);

    // Conditionally load Softrol routes based on environment setting
    if (server.config.softrol) {
        app.use('/api/softrol', softrolRoutes);
    }

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