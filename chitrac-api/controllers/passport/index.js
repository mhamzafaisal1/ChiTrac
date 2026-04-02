/*** alpha API controller */
/*** Contributors: RTI II */

/** MODULE REQUIRES */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ObjectId = require('mongodb').ObjectId;
const config = require('../../modules/config');
const timestampsSchema = require('../../schemas/timestampsSchema');
const { sendPasswordResetLinkEmail } = require('../../modules/passwordResetEmail');
const {
    parseOptionalEmail,
    isEmailTaken,
    findUserByEmailCaseInsensitive
} = require('../../modules/userEmail');
const makeJwtVerifyMiddleware = require('../../middleware/jwtVerify');

function publicRequestBaseUrl(req) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host') || '';
    return `${proto}://${host}`;
}

function publicUserPayload(user) {
    const userObject = { ...user.local };
    delete userObject.password;
    if (user.emailAddress != null && user.emailAddress !== '') {
        userObject.emailAddress = user.emailAddress;
    }
    if (user._id != null) {
        userObject._id = user._id.toString ? user._id.toString() : user._id;
    }
    return userObject;
}

module.exports = function(server) {
    return constructor(server);
}

function constructor(server) {
    const db = server.db;
    const logger = server.logger;
    const passport = server.passport;
    const verifyJwtMiddleware = makeJwtVerifyMiddleware(server);

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
                const token = jwt.sign(
                    { 
                        userId: user._id,
                        username: user.local.username,
                        role: user.role || 'user'
                    },
                    config.jwtSecret,
                    { expiresIn: '24h' }
                );
                
                res.json({
                    user: publicUserPayload(user),
                    token: token
                });
            });
        })(req, res, next);
    })

    router.get('/user', function(req, res) {
        if (req.isAuthenticated()) {
            res.json({
                user: publicUserPayload(req.user)
            });
        } else {
            sendFlashJSON(req, res)
        }
    })

    router.get('/users/hasEmail', verifyJwtMiddleware, async (req, res) => {
        try {
            const userCollection = db.collection('user');
            const rows = await userCollection
                .find(
                    { emailAddress: { $ne: null } },
                    { projection: { _id: 1, emailAddress: 1, 'local.username': 1 } }
                )
                .sort({ 'local.username': 1 })
                .toArray();
            const users = rows.map((u) => ({
                _id: u._id.toString(),
                emailAddress: u.emailAddress,
                local: { username: u.local?.username ?? '' }
            }));
            res.json({ users });
        } catch (err) {
            logger.error(err);
            res.status(500).json({ error: 'Failed to load users.' });
        }
    });

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
            const parsedEmail = parseOptionalEmail(req.body.emailAddress);
            if (!parsedEmail.ok) {
                return res.status(400).json({ error: parsedEmail.message });
            }
            if (parsedEmail.email !== null && await isEmailTaken(userCollection, parsedEmail.email)) {
                return res.status(409).json({ error: 'That email address is already in use.' });
            }
            const userFind = await userCollection.find({ 'local.username': user.username }).toArray();
            if (userFind.length) {
                req.flash('messages', 'That username is already taken.')
                sendFlashJSON(req, res);
            } else {
                let newUser = {
                    local: {
                        username: null,
                        password: null,
                    }
                };

                newUser.local.username = user.username;

                const salt = bcrypt.genSaltSync(10);
                const hash = bcrypt.hashSync(user.password, salt);
                newUser.local.password = hash;
                if (parsedEmail.email !== null) {
                    newUser.emailAddress = parsedEmail.email;
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

                try {
                    const insertResult = await userCollection.insertOne(newUser);
                    if (insertResult.insertedId) {
                        newUser._id = insertResult.insertedId;
                    }
                    const responseUser = publicUserPayload(newUser);
                    return res.json({ ...responseUser, message: 'User created successfully.' });
                } catch (error) {
                    logger.error(error);
                    return res.status(500).json({ error: 'Failed to create user.' });
                }

            }
        } catch (error) {
            logger.error(error);
            return res.status(500).json({ error: 'Failed to create user.' });
        }
    })

    router.post('/user/requestPasswordReset', async (req, res) => {
        try {
            const raw = req.body?.emailAddress;
            if (raw === undefined || raw === null || String(raw).trim() === '') {
                return res.status(400).json({ error: 'No email address provided.' });
            }
            const parsed = parseOptionalEmail(raw);
            if (!parsed.ok) {
                return res.status(400).json({ error: parsed.message });
            }
            if (parsed.email === null) {
                return res.status(400).json({ error: 'No email address provided.' });
            }
            const userCollection = db.collection('user');
            const user = await findUserByEmailCaseInsensitive(userCollection, parsed.email);
            if (!user || !user.emailAddress) {
                return res.status(404).json({ error: 'No user found for this email address.' });
            }

            const now = new Date();
            const nowIso = now.toISOString();
            const expiresIso = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

            const resetJwt = jwt.sign(
                { userId: user._id.toString(), type: 'passwordReset' },
                config.jwtSecret,
                { expiresIn: '15m' }
            );

            const resetToken = {
                token: resetJwt,
                timestamps: timestampsSchema.utils.stampInit(nowIso, null, null, null, expiresIso)
            };

            await userCollection.updateOne({ _id: user._id }, { $set: { resetToken } });

            const resetUrl = `${publicRequestBaseUrl(req)}/ng/settings/user/resetPassword/${encodeURIComponent(resetJwt)}`;

            try {
                await sendPasswordResetLinkEmail({ to: user.emailAddress, resetUrl });
            } catch (mailErr) {
                logger.error(mailErr);
                if (mailErr.code === 'SMTP_CONFIG') {
                    return res.status(503).json({ error: 'Email is not configured on the server.' });
                }
                return res.status(500).json({ error: 'Failed to send reset email.' });
            }

            return res.json({ ok: true, message: 'Reset link sent.' });
        } catch (err) {
            logger.error(err);
            return res.status(500).json({ error: 'Failed to request password reset.' });
        }
    });

    router.get('/user/resetPassword/:token', async (req, res) => {
        try {
            const token = req.params.token ? decodeURIComponent(req.params.token) : '';
            if (!token) {
                return res.status(400).json({ error: 'Missing reset token.' });
            }
            let decoded;
            try {
                decoded = jwt.verify(token, config.jwtSecret);
            } catch {
                return res.status(400).json({ error: 'Invalid or expired reset token.' });
            }
            if (decoded.type !== 'passwordReset' || !decoded.userId) {
                return res.status(400).json({ error: 'Invalid reset token.' });
            }
            const userCollection = db.collection('user');
            let user;
            try {
                user = await userCollection.findOne({ _id: new ObjectId(decoded.userId) });
            } catch {
                return res.status(400).json({ error: 'Invalid reset token.' });
            }
            if (!user || !user.resetToken || user.resetToken.token !== token) {
                return res.status(400).json({ error: 'Invalid or expired reset token.' });
            }
            return res.json(publicUserPayload(user));
        } catch (err) {
            logger.error(err);
            return res.status(500).json({ error: 'Failed to verify reset token.' });
        }
    });

    router.post('/user/resetPassword', async (req, res) => {
        try {
            const bodyUser = req.body?.user;
            if (!bodyUser || !bodyUser._id || bodyUser.newPassword === undefined) {
                return res.status(400).json({ error: 'Missing user or new password.' });
            }
            const username = bodyUser.local?.username;
            const emailAddress = bodyUser.emailAddress;
            if (!username || emailAddress === undefined || emailAddress === null || String(emailAddress).trim() === '') {
                return res.status(400).json({ error: 'Missing username or email address.' });
            }
            if (String(bodyUser.newPassword).length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters.' });
            }

            const userCollection = db.collection('user');
            let user;
            try {
                user = await userCollection.findOne({ _id: new ObjectId(String(bodyUser._id)) });
            } catch {
                return res.status(400).json({ error: 'Invalid user id.' });
            }
            if (!user) {
                return res.status(404).json({ error: 'User not found.' });
            }

            const parsedBodyEmail = parseOptionalEmail(emailAddress);
            const bodyEmailNorm =
                parsedBodyEmail.ok && parsedBodyEmail.email
                    ? parsedBodyEmail.email
                    : String(emailAddress).trim().toLowerCase();
            const dbEmail = user.emailAddress ? String(user.emailAddress).toLowerCase() : '';
            if (user.local.username !== username || dbEmail !== bodyEmailNorm) {
                return res.status(400).json({ error: 'User details do not match.' });
            }
            if (!user.resetToken) {
                return res.status(400).json({ error: 'No active password reset for this account.' });
            }

            const salt = bcrypt.genSaltSync(10);
            const hash = bcrypt.hashSync(bodyUser.newPassword, salt);

            const up = await userCollection.updateOne(
                { _id: user._id, 'local.username': username },
                { $set: { 'local.password': hash }, $unset: { resetToken: '' } }
            );
            if (up.matchedCount === 0) {
                return res.status(500).json({ error: 'Failed to update password.' });
            }

            return res.json({ ok: true, message: 'Password updated.' });
        } catch (err) {
            logger.error(err);
            return res.status(500).json({ error: 'Failed to reset password.' });
        }
    });

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