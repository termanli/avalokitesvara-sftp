var extend = require('util')._extend;
var Client = require('ssh2').Client;
var EventEmitter = require('events').EventEmitter;
SFTP = function () {
	let privateProps = new WeakMap();
	let default_constructor_parameter = {
		host: "localhost",
		port: 22,
		user: 'root',
		maxSessionCount: 10,
		ontinueOnError: false
	};
	let gp = function (obj, property) {
		return privateProps.get(obj)[property];
	};
	let create_sessions = function (obj, conn, onReady = function () {
		conn.end();
	}) {
		var session_pool = gp(obj, 'session_pool');
		if (session_pool.length < obj.maxSessionCount) {
			conn.sftp(function (err, sftp) {
				if (err) {
					console.dir(err);
					conn.end();
				}
				session_pool.unshift(sftp);
				create_sessions(obj, conn, onReady);
			});
		} else {
			onReady()
		}
	};
	let runNextOperation = function (obj, sftp) {
		return function () {
			let result = false;
			if (obj.started) {
				let operation = gp(obj, 'operations').pop();
				if (operation) {
					operation(sftp, runNextOperation(obj, sftp));
					result = true;
				}
			}
			if (!result) {
				gp(obj, 'session_pool').unshift(sftp);
			}
			return result;
		}
	}
	let commitOperation = function (obj, operation) {
		if (obj.started) {
			let sftp = gp(obj, 'session_pool').pop();
			if (sftp) {
				operation(sftp, runNextOperation(obj, sftp));
			} else {
				gp(obj, 'operations').unshift(operation);
			}
		} else {
			gp(obj, 'operations').unshift(operation);
		}
	}
	let errorHandler = function (obj, err) {
		if (err) {
			console.dir(err);
			obj.emit('error');
			if (!obj.ontinueOnError) {
				obj.stop();
			}
		}
	}
	return class extends EventEmitter {
		constructor(opts = {}) {
			super();
			var o = extend(extend({}, default_constructor_parameter), opts);
			o['operations'] = new Array();
			o['started'] = false;
			o['session_pool'] = new Array();
			console.log(o);
			privateProps.set(this, o); // this is private
			console.log(privateProps.get(this));
		}
		get host() {
			return gp(this, 'host');
		}
		get port() {
			return gp(this, 'port');
		}
		get user() {
			return gp(this, 'user');
		}
		get password() {
			return gp(this, 'password');
		}
		get algorithms() {
			return gp(this, 'algorithms');
		}
		get maxSessionCount() {
			return gp(this, 'maxSessionCount');
		}
		get started() {
			return gp(this, 'started');
		}
		get ontinueOnError() {
			return gp(this, 'ontinueOnError');
		}
		start() {
			let conn = new Client();
			privateProps.get(this)['connection'] = conn;
			/*let onEnd = opts['onEnd'] ? opts['onEnd'] : function() {
				conn.end();
			}
			let onErr = opts['onErr'] ? opts['onErr'] : function() {
				conn.end();
			}*/
			let connParam = {
				host: this.host,
				port: this.port,
				username: this.user
			};
			if (this.password) {
				connParam['password'] = this.password;
			}
			if (this.algorithms) {
				connParam['algorithms'] = this.algorithms;
			}
			conn.on('error', function (err) {
				console.dir(err);
				/*onErr(err, conn, opts);*/
			}).on('ready', function (t) {
				return function () {
					create_sessions(t, conn, function () {
						privateProps.get(t)['started'] = true;
						let sftp = gp(t, 'session_pool').pop();
						while (sftp) {
							if (runNextOperation(t, sftp)()) {
								sftp = gp(t, 'session_pool').pop();
							} else {
								break;
							}
						}
					});
				}
			}(this)).connect(connParam);
		}
		stop() {
			privateProps.get(this)['started'] = false;
		}
		listFolder(path, opts = {}) {
			let event = new EventEmitter();
			var operation = function (t, event) {
				return function (sftp, onEnd) {
					let show_list = function (b) {
						return function (err, list) {
							if (err) {
								if (err.code == 1) {
									sftp.close(b, function (err) {
										if (err) {
											console.dir(err);
											console.log(`path:${path}`);
										}
									});
									onEnd();
								} else {
									errorHandler(t, err);
								}
							} else {
								var f;
								for (f in list) {
									var need_collect = true;
									if (opts['filter']) {
										if (opts.filter(list[f])) {
											need_collect = true;
										} else {
											need_collect = false;
										}
									}
									if (need_collect) {
										if (opts['collector']) {
											opts.collector(list[f]);
											/*commitOperation(t, function(sftp, onEnd) {
												opts.collector(list[f], onEnd);
											});*/
										} else {
											console.log(list[f]);
										}
									}
								}
								event.emit('continue');
							}
						};
					};
					sftp.opendir(path, function (err, buf) {
						if (err) {
							console.log("Failed open dir " + path);
							console.dir(err);
							return;
						}
						let fun = show_list(buf);
						event.on('continue', function (b, f) {
							return function () {
								sftp.readdir(b, f);
							}
						}(buf, fun));
						sftp.readdir(buf, fun);
					});

				};
			}(this, event);
			commitOperation(this, operation);
		}
		traverseFolder(path, opts = {}) {
			let collectorFun = function (t, p) {
				return function (f) {
					let p1 = `${p}${p.match(/.*\/$/) ? '' : '/'}${f.filename}`;
					if (utils.isFolder(f)) {
						console.log(`listing ${p1}`);
						t.listFolder(p1, {
							collector: collectorFun(t, p1)
						});
					}
					console.log(`${p1}`);
					console.log(t.started);
				}
			};
			this.listFolder(path, {
				collector: collectorFun(this, path)
			});
		}
	}
}();
var testFile = function (f, mode) {
	var a = f['attrs'];
	if (a) {
		var m = a['mode'];
		if ((m & 0770000) == mode) {
			return true;
		}
	}
	return false;
}
var utils = {
	isFile: function (f = {}) {
		return testFile(f, 0100000);
	},
	isFolder: function (f = {}) {
		return testFile(f, 0040000);
	}
}
SFTP.utils = utils
module.exports = SFTP;