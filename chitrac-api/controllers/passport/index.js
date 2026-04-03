/*** alpha API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

module.exports = function(server) {
    return constructor(server);
}

function constructor(server) {
    const db = server.db;
    const logger = server.logger;
    const passport = server.passport;

    router.get('/passport', (req, res, next) => {
        res.json(server.passport);
    });

    function routePublic(req, res, fileName) {
        var options = {
            root: __dirname + '/../public/',
            dotfiles: 'deny',
            headers: {
                'x-timestamp': Date.now(),
                'x-sent': true
            },
        };
        res.sendFile(fileName, options, function(err) {
            if (err) {
                // Debug: Error occurred
                res.status(err.status).end();
            } else {
                // Debug: File sent successfully
            }
        });
    }

    // route middleware to make sure a user is logged in
    function isLoggedIn(req, res, next) {

        // if user is authenticated in the session, carry on
        if (req.isAuthenticated())
            return next()

        req.flash('messages', 'You are not authorized to access ' + req.path + '. Please log in first')

        //sendFlashJSON(req, res)
        routePublic(req, res, 'index.html')

    }

    function sendFlashJSON(req, res) {
        var json = {
            messages: req.flash('messages')
        };
        res.json(json);
    };

    // =====================================
    // LOGIN ===============================
    // =====================================
    // show the login form
    router.get('/user/login', function(req, res) {
        sendFlashJSON(req, res);
    });

    // process the login form
    router.post('/user/login', (req, res, next) => {
        passport.authenticate('local-login', (err, user, info) => {
            if (err) {
                return res.status(500).json({ error: 'Authentication error' });
            }
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            req.logIn(user, (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Login error' });
                }
                
                // Generate JWT token
                const jwt = require('jsonwebtoken');
                const config = require('../../modules/config');
                const token = jwt.sign(
                    { 
                        userId: user._id,
                        username: user.local.username,
                        role: user.role || 'user'
                    },
                    config.jwtSecret,
                    { expiresIn: '24h' }
                );
                
                // Return user data and token
                const userObject = { ...user.local };
                delete userObject.password;
                
                res.json({
                    user: userObject,
                    token: token
                });
            });
        })(req, res, next);
    })

    router.get('/user', function(req, res) {
        if (req.isAuthenticated()) {
            var userObject = req.user.local
            delete userObject.password
            res.json({
                user: userObject
            })
        } else {
            sendFlashJSON(req, res)
        }
    })

    // =====================================
    // SIGNUP ==============================
    // =====================================
    // show the signup form
    router.get('/user/signup', function(req, res) {
        sendFlashJSON(req, res);
    });

    // process the signup form
    router.post('/user/signup', isLoggedIn, passport.authenticate('local-signup', {
        successRedirect: '/api/passport/user', // redirect to the secure profile section
        failureRedirect: '/api/passport/signup', // redirect back to the signup page if there is an error
        failureFlash: true // allow flash messages
    }))

    router.post('/user/register', async (req, res) => {
        try {
            const userCollection = db.collection('user');
            const user = req.body;
            const userFind = await userCollection.find({ 'local.username': user.username }).toArray();
            if (userFind.length) {
                req.flash('messages', 'That username is already taken.')
                sendFlashJSON(req, res);
            } else {
                // if there is no user with that email
                // create the user
                let newUser = {
                    local: {
                        username: null,
                        password: null,
                    }
                };

                // set the user's local credentials
                newUser.local.username = user.username;

                const salt = bcrypt.genSaltSync(10);
                const hash = bcrypt.hashSync(user.password, salt);
                newUser.local.password = hash;
                if (req.body.email) {
                    newUser.email = req.body.email
                }
                if (req.body.role) {
                    newUser.role = req.body.role
                }
                if (req.body.groups) {
                    newUser.groups = req.body.groups
                }
                if (req.body.restrictions) {
                    newUser.restrictions = req.body.restrictions
                }

                // save the user
                try {
                    const newUserInsert = await userCollection.insertOne(newUser);
                    return res.json(newUser);
                } catch (error) {
                    logger.error(error);
                    return res.json(error)
                }

            }
        } catch (error) {
            logger.error(error);
            return res.json(error);
        }
    })

    // =====================================
    // LOGOUT ==============================
    // =====================================
    router.get('/user/logout', function(req, res, next) {
        if (req.user) {
            // Debug: User logout
            req.flash('messages', 'Thank you for logging out, ' + req.user.local.username)
            req.logout((err) => {
                if (err) return next(err);

            })
        } else {
            req.flash('messages', 'Cannot log out if you are not logged in!')
        }
        sendFlashJSON(req, res);
    })

    return router;
}