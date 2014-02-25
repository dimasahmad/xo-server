'use strict';

//====================================================================

var parseUrl = require('url').parse;

//--------------------------------------------------------------------

var backOff = require('backoff');
var extend = require('underscore').extend;
var q = require('q');
var xmlrpc = require('xmlrpc');

//====================================================================

var slice = Array.prototype.slice;
slice = slice.call.bind(slice);

//====================================================================

var Xapi = function (options) {
	this.host = options.host;
	this.username = options.username;
	this.password = options.password;

	// Integrates node-backoff with promises.
	this._backOff = (function () {
		var deferred;

		var bo = backOff.fibonacci({
			initialDelay: 1e2,
			maxDelay: 1e4,
		});
		bo.failAfter(10);

		bo.on('backoff', function (number) {
			if (0 === number)
			{
				deferred = q.defer();
				bo.promise = deferred.promise;
			}
		});
		bo.on('ready', function () {
			deferred.resolve();
		});
		bo.on('fail', function (error) {
			deferred.reject(error);
		});

		return bo;
	})();

	this.connect();
};

extend(Xapi.prototype, {

	// Connects to the server.
	connect: function (force) {
		var hostname, port;
		(function () {
			var tmp = parseUrl('http://'+ this.host);
			hostname = tmp.hostname;
			port = tmp.port;
		}).call(this);

		if (!force && this.xmlrpc && (hostname === this.xmlrpc.options.host))
		{
			return;
		}

		delete this.sessionId;

		this.xmlrpc = xmlrpc.createSecureClient({
			host: hostname,
			port: port || 443,
			rejectUnauthorized: false,
		});

		return this._logIn();
	},

	// Calls a method.
	call: function (method) {
		var args = slice(arguments, 1);
		var self = this;

		// This helper function is necessary to handle recursivity when
		// there is `SESSION_INVALID` error.
		return (function loop() {
			return q(self._sessionId).then(function (sessionId) {
				return self._call(
					method,
					[sessionId].concat(args)
				).catch(function (error) {
					if ('SESSION_INVALID' === error[0])
					{
						return self._logIn().then(loop);
					}

					throw error;
				});
			});
		})();
	},

	_call: function (method, args) {
		var self = this;

		// This helper function is necessary to handle recursivity when
		// there is a retriable error.
		return (function loop() {
			return q.ninvoke(
				self.xmlrpc, 'methodCall',
				method, args
			).then(function (result) {
				// Returns the plain result if it does not have a valid XAPI format.
				if (!('Status' in result))
				{
					return result;
				}

				// If the status is not “Success”, throws the error.
				if ('Success' !== result.Status)
				{
					throw result.ErrorDescription;
				}

				self._backOff.reset();
				return result.Value;
			}).catch(function (error) {
				// Gets the error code for transport and XAPI errors.
				var code = error.code || error[0];

				if ('HOST_IS_SLAVE' === code)
				{
					// Lets retry with the same credentials on the new master.
					self.host = error[1];
					return self.connect().then(function () {
						return self._call(method, args);
					});
				}

				if (!(code in {
					ECONNRESET: true,
					ECONNREFUSED: true,
					EHOSTUNREACH: true,

					HOST_STILL_BOOTING: true,
					HOST_HAS_NO_MANAGEMENT_IP: true,
				}))
				{
					// Forwards error.
					throw error;
				}

				self._backOff.backoff(error);
				return self._backOff.promise.then(loop);
			});
		})();
	},

	_logIn: function () {
		this._sessionId = this._call(
			'session.login_with_password',
			[this.username, this.password]
		);

		return this._sessionId;
	},
});

//====================================================================

module.exports = Xapi;
