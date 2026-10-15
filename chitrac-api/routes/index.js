const path = require('path');
const express = require('express');
const { createVerifyJwtMiddleware } = require('../utils/authMiddleware');


function init(app, server) {
    // Must precede every API registration, including the direct machine XML routes.
    app.use('/api', require('../utils/apiControllerAccess').createApiControllerAccess(server));
    const spindleEnabled = process.env.SPINDLE === 'true';
    const milnorEnabled = process.env.MILNOR === 'true';
    const softrolEnabled = process.env.SOFTROL === 'true';
    const machineRoutes = require('../controllers/machine')(server);
    const itemRoutes = require('../controllers/item')(server);
    const operatorRoutes = require('../controllers/operator')(server);
    const statusRoutes = require('../controllers/status')(server);
    const softrolRoutes = require('../controllers/softrol')(server);
    const milnorRoutes = require('../controllers/milnor')(server);
    const spindleRoutes = require('../controllers/spindle')(server);
    const alphaController = require('../controllers/alpha');
    const alphaRoutes = alphaController(server);
    alphaController.registerMachineXmlRoutes(app, server);
    const bikoRoutes = require('../controllers/biko')(server);
    const authRoutes = require('../controllers/auth')(server);
    const userRoutes = require('../controllers/users')(server);
    const preferencesRoutes = require('../controllers/preferences')(server);
    const passportRoutes = require('../controllers/passport')(server);
    const historyRoutes = require('../controllers/history')(server);
    const utilitiesRoutes = require('../controllers/utilities')(server);
    const jiraRoutes = require('../controllers/jira')(server);
    const dashboardRoutes = require('../controllers/dashboard')(server);
    const faultRoutes = require('../controllers/fault')(server);
    const reportRoutes = require('../controllers/reports')(server);
    const verifyJwtMiddleware = createVerifyJwtMiddleware(server);


    app.get('/docs/api', (req, res, next) => {
        res.sendFile(path.join(server.appRoot.path, '/docs/api.html'));
    });

    app.get('/docs/cd/readme', (req, res, next) => {
        res.sendFile(path.join(server.appRoot.path, '/docs/cd/readme.html'));
    });

    // Conditionally load Softrol documentation based on environment setting
    if (softrolEnabled) {
        app.get('/docs/api/softrol', (req, res, next) => {
            res.sendFile(path.join(server.appRoot.path, '/docs/api-softrol.html'));
        });
    }

    // Conditionally load Milnor documentation based on environment setting
    if (milnorEnabled) {
        app.get('/docs/api/milnor', (req, res, next) => {
            res.sendFile(path.join(server.appRoot.path, '/docs/api-milnor.html'));
        });
    }

    // Conditionally load Spindle documentation based on environment setting
    if (spindleEnabled) {
        app.get('/docs/api/spindle', (req, res, next) => {
            res.sendFile(path.join(server.appRoot.path, '/docs/api-spindle.html'));
        });
    }

    app.use('/api/alpha', alphaRoutes);
    app.use('/api/biko', bikoRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/preferences', preferencesRoutes);
    // Keep the existing settings URL backed by the consolidated preferences controller.
    app.use('/api/system-preferences', (req, res, next) => {
        req.url = `/system${req.url}`;
        preferencesRoutes(req, res, next);
    });
    app.use('/api/passport', passportRoutes);

    // Conditionally load Softrol routes based on environment setting
    if (softrolEnabled) {
        app.use('/api/softrol', softrolRoutes);
    }

    // Conditionally load Milnor routes based on environment setting
    if (milnorEnabled) {
        app.use('/api/milnor', verifyJwtMiddleware, milnorRoutes);
    }

    // Conditionally load Spindle routes based on environment setting
    if (spindleEnabled) {
        app.use('/api/spindle', spindleRoutes);
    }

    app.use('/api/history', historyRoutes);
    
    app.use('/api/utilities', utilitiesRoutes);
    app.use('/api/jira', jiraRoutes);

    app.use('/fonts/normal', express.static(path.join(server.appRoot.path, 'fonts/Montserrat-VariableFont_wght.ttf')));
    app.use('/fonts/bold', express.static(path.join(server.appRoot.path, 'fonts/Montserrat-VariableFont_wght.ttf')));
    app.use('/icons', express.static(path.join(server.appRoot.path, 'icons/MaterialSymbolsOutlined_Filled-Regular.ttf')));
    app.use('/uploads/images', express.static(path.join(server.appRoot.path, 'uploads/images')));
    app.use(['/ng/*', '/'], express.static(path.join(server.appRoot.path, 'ng/browser/')));
    

    app.use('/api', machineRoutes);
    app.use('/api', itemRoutes);
    app.use('/api', operatorRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use('/api/fault', faultRoutes);
    app.use('/api/reports', reportRoutes);
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
