/*** alpha API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const config = require('../../modules/config');
const { assertPermissionLevel, getPermissionLevel } = require('../../modules/permissions');

module.exports = function(server) {
    return constructor(server);
}

function constructor(server) {
    const db = server.db;
    const logger = server.logger;
    const passport = server.passport;

    function normalizePermissionLevel(value, defaultLevel = 3) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultLevel;
    }

    function extractToken(req) {
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];
        if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
        if (typeof req.query?.token === 'string') return req.query.token;
        if (typeof req.body?.token === 'string') return req.body.token;
        return null;
    }

    function getTokenUserId(payload) {
        const rawUserId = payload?.userId;
        if (!rawUserId) return null;
        if (typeof rawUserId === 'string') return rawUserId;
        if (typeof rawUserId === 'object' && rawUserId.$oid) return rawUserId.$oid;
        return `${rawUserId}`;
    }

    function requirePermissionLevel(requiredLevel) {
        return async function(req, res, next) {
            if (config.enableApiTokenCheck === false) {
                req.authUser = { active: true, permissions: { level: 0 } };
                return next();
            }

            try {
                const token = extractToken(req);
                if (!token) return res.status(401).json({ error: 'Missing token' });

                const payload = jwt.verify(token, config.jwtSecret);
                const tokenUserId = getTokenUserId(payload);
                if (!tokenUserId) return res.status(401).json({ error: 'Invalid token payload' });

                const user = await db.collection('user').findOne({ _id: new ObjectId(tokenUserId) });
                assertPermissionLevel(user, requiredLevel);
                req.authUser = user;
                return next();
            } catch (error) {
                logger?.error?.('Permission check failed:', error);
                return res.status(error.status || 401).json({ error: error.message || 'Invalid token' });
            }
        };
    }

    function canManagePermissionLevel(authUser, targetLevel) {
        const authLevel = getPermissionLevel(authUser);
        return typeof targetLevel === 'number' && authLevel !== null && targetLevel >= authLevel;
    }

    function sanitizeUser(user) {
        const userObject = { ...user.local };
        delete userObject.password;
        userObject.email = user.email || '';
        userObject.role = user.role || 'user';
        userObject.permissions = {
            level: typeof user.permissions?.level === 'number' ? user.permissions.level : 3
        };
        userObject.groups = Array.isArray(user.groups) ? user.groups : [];
        return userObject;
    }

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
                        role: user.role || 'user',
                        permissions: {
                            level: typeof user.permissions?.level === 'number' ? user.permissions.level : 3
                        }
                    },
                    config.jwtSecret,
                    { expiresIn: '24h' }
                );
                
                // Return user data and token
                res.json({
                    user: sanitizeUser(user),
                    token: token
                });
            });
        })(req, res, next);
    })

    router.get('/user', function(req, res) {
        if (req.isAuthenticated()) {
            res.json({
                user: sanitizeUser(req.user)
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

    router.post('/user/register', requirePermissionLevel(2), async (req, res) => {
        try {
            const userCollection = db.collection('user');
            const user = req.body;
            const permissionLevel = normalizePermissionLevel(req.body.permissions?.level ?? req.body.permissionLevel);
            if (!canManagePermissionLevel(req.authUser, permissionLevel)) {
                return res.status(403).json({ error: 'Cannot create a user with a higher permission level than your own' });
            }

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
                newUser.local.username = username;

                const salt = bcrypt.genSaltSync(10);
                const hash = bcrypt.hashSync(user.password, salt);
                newUser.local.password = hash;
                if (email) {
                    newUser.email = email
                }
                if (req.body.role) {
                    newUser.role = req.body.role
                }
                newUser.permissions = {
                    level: permissionLevel
                }
                if (req.body.groups) {
                    newUser.groups = Array.isArray(req.body.groups) ? req.body.groups : []
                } else {
                    newUser.groups = []
                }
                if (req.body.restrictions) {
                    newUser.restrictions = req.body.restrictions
                }

                // save the user
                try {
                    await userCollection.insertOne(newUser);
                    const safeUser = {
                        ...newUser,
                        local: {
                            ...newUser.local
                        }
                    };
                    delete safeUser.local.password;
                    return res.json({ message: 'User created successfully.', user: safeUser });
                } catch (error) {
                    logger.error(error);
                    return res.status(500).json({ message: 'Failed to create user.' });
                }

            }
        } catch (error) {
            logger.error(error);
            return res.status(500).json({ message: 'Failed to register user.' });
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
