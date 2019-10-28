(function (module) {
	"use strict";

	var User = require.main.require("./src/user'),
		meta = require.main.require("./src/meta'),
		db = module.parent.require('../src/database'),
		passport = require.main.require("./src/passport'),
		passportMixer = require('passport-mixer').OAuth2Strategy,
		fs = module.parent.require('fs'),
		path = module.parent.require('path'),
		nconf = module.parent.require('nconf'),
		async = module.parent.require('async');

	var constants = Object.freeze({
		'name': "Mixer.com",
		'admin': {
			'route': '/plugins/sso-mixer',
			'icon': 'icon-mixer'
		}
	});


	var Mixer = {};

	Mixer.init = function (data, callback) {
		function render(req, res, next) {
			res.render('admin/plugins/sso-mixer', {});
		}

		data.router.get('/admin/plugins/sso-mixer', data.middleware.admin.buildHeader, render);
		data.router.get('/api/admin/plugins/sso-mixer', render);

		callback();
	};


	Mixer.getStrategy = function (strategies, callback) {
		meta.settings.get('sso-mixer', function(err, settings) {
			if (!err && settings['id'] && settings['secret']) {

				passport.use(new passportMixer({
					clientID: settings['id'],
					clientSecret: settings['secret'],
					callbackURL: nconf.get('url') + '/auth/mixer/callback'
				}, function (accessToken, refreshToken, profile, done) {
					Mixer.login(profile.id, profile.username, profile.email, profile._raw, function (err, user) {
						if (err) {
							return done(err);
						}
						done(null, user);
					});
				}));

				strategies.push({
					name: 'mixer',
					url: '/auth/mixer',
					callbackURL: '/auth/mixer/callback',
					icon: constants.admin.icon,
					scope: settings['scope'] || 'user:details:self'
				});
			}

			callback(null, strategies);
		});
	};

  Mixer.forceAvatar = function(uid,avatar) {
    User.setUserFields(uid, {
      uploadedpicture: avatar.avatarUrl || 'https://mixer.com/_latest/assets/images/main/avatars/default.jpg',
      picture: avatar.avatarUrl || 'https://mixer.com/_latest/assets/images/main/avatars/default.jpg'
    });

  };

  Mixer.login = function (mixerId, handle, email, avatar, callback) {

    Mixer.getUidByBeamId(mixerId, function (err, uid) {
      if (err) {
        return callback(err);
      }

      if (uid !== null) {
        // Existing User
        meta.settings.get('sso-mixer', function (err, settings) {
          var forceAvatar = settings && settings['forceAvatar'] === "on" ? 1 : 0;
          if( forceAvatar ) {
            Mixer.forceAvatar(uid, avatar);
          }
        });
        callback(null, {
          uid: uid
        });
      } else {
        // New User
        var success = function (uid) {
          meta.settings.get('sso-mixer', function (err, settings) {
            var autoConfirm = settings && settings['autoconfirm'] === "on" ? 1 : 0;
            var forceAvatar = settings && settings['forceAvatar'] === "on" ? 1 : 0;
            if( forceAvatar ) {
              Mixer.forceAvatar(uid, avatar);
            }
            User.setUserField(uid, 'email:confirmed', autoConfirm);
            User.setUserField(uid, 'beamid', mixerId);
            db.setObjectField('beamid:uid', mixerId, uid);

            callback(null, {
              uid: uid
            });

          });
        };

        User.getUidByEmail(email, function(err, uid) {
          if (err) {
            return callback(err);
          }

          if (!uid) {
            User.create({username: handle, email: email}, function (err, uid) {
              if (err) {
                return callback(err);
              }
              success(uid);
            });
          } else {
            success(uid); // Existing account -- merge
          }
        });
      }
    });
  };

  Mixer.getUidByBeamId = function (mixerId, callback) {
    db.getObjectField('beamid:uid', mixerId, function(err, uid) {
      if (err) {
        return callback(err);
      }
      callback(null, uid);
    });
  };

  Mixer.addMenuItem = function (custom_header, callback) {
    custom_header.authentication.push({
      "route": constants.admin.route,
      "icon": constants.admin.icon,
      "name": constants.name
    });

    callback(null, custom_header);
  };


  Mixer.deleteUserData = function(data, callback) {
    var uid = data.uid;
    async.waterfall([
      async.apply(User.getUserField, uid, 'beamid'),
      function (oAuthIdToDelete, next) {
        db.deleteObjectField('beamid:uid', oAuthIdToDelete, next);
      }
    ], function(err) {
      if (err) {
        winston.error('[sso-mixer] Could not remove OAuthId data for uid ' + uid + '. Error: ' + err);
        return callback(err);
      }
      callback(null, uid);
    });
  };

	module.exports = Mixer;
}(module));
