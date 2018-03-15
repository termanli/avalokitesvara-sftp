"use strict";
var extend = require('util')._extend;
var Client = require('ssh2').Client;
var EventEmitter = require('events').EventEmitter;
/**
     * Class SFTP repretation a connection service to a SFTP server.
     * @class SFTP
	 * @param {object} opts
	 * @param {string} [opts.host='localhost'] the hostname of remote sftp server
	 * @param {int} [opts.port=22] the port number of remote sftp server
	 * @param {string} [opts.user=root] the login user
	 * @param {boolean} [opts.continueOnError=false] indicate the service if keep process other operations if error occured. 
	 * @param {int} [opts.maxSessionCount=10] the max sftp session could be opened in the connection
	 * @param {object} [opts.algorithms] This option allows you to explicitly override the default transport layer algorithms used for the connection. Each value must be an array of valid algorithms for that category. The order of the algorithms in the arrays are important, with the most favorable being first. See {@link https://github.com/mscdex/ssh2-streams#ssh2stream-methods}
	 * @param {string[]} [opts.algorithms.kex] Key exchange algorithm
	 * @param {string[]}  [opts.algorithms.cipher] Ciphers
	 * @param {string[]}  [opts.algorithms.hmac] (H)MAC algorithms
	 * @param {string[]}  [opts.algorithms.compress] Compression algorithms
	 * @param {string} [opts.password] the login password
    */
var SFTP = function () {
	let privateProps = new WeakMap();
	let default_constructor_parameter = {
		host: "localhost",
		port: 22,
		user: 'root',
		maxSessionCount: 10,
		continueOnError: false
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
			if (!obj.continueOnError) {
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
		get continueOnError() {
			return gp(this, 'continueOnError');
		}
		start() {
			if (this.started) {
				return;
			}
			let conn = new Client();
			privateProps.get(this)['connection'] = conn;
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
			if (gp(this, 'connection')) {
				privateProps.get(this)['started'] = false;
				privateProps.get(this)['session_pool'] = new Array();
				gp(this, 'connection').end();
				delete privateProps.get(this)['connection'];
			}

		}
		/**
		 * @typedef {Object} FileListItem
		 * @memberOf SFTP
		 * @property {string} filename the name of the file
		 * @property {string} longname the longname of the file the format is like ls -l output '{file permissions} {number of links} {owner name} {owner group} {file size} {time of last modification} {file/directory name}' for example 'd-wx--x--x    3 root     root           17 Mar  2 21:28 abc'
		 * @property {ssh2-streams.SFTPStream.Stats} attrs file attributes {@link https://github.com/mscdex/ssh2-streams/blob/master/SFTPStream.md#stats}
		 * @property {int} attrs.mode Mode/permissions for the resource
		 * @property {int} attrs.uid User ID of the resource.
		 * @property {int} attrs.gid  Group ID of the resource.
		 * @property {int} attrs.size  Resource size in bytes.
		 * @property {int} attrs.atime  UNIX timestamp of the access time of the resource.
		 * @property {int} attrs.mtime UNIX timestamp of the modified time of the resource.
		 * @property {function} attrs.isDirectory()
		 * @property {function} attrs.isFile()
		 * @property {function} attrs.isBlockDevice()
		 * @property {function} attrs.isCharacterDevice()
		 * @property {function} attrs.isSymbolicLink()
		 * @property {function} attrs.isFIFO()
		 * @property {function} attrs.isSocket()
		*/
		/**
		 * A function to perform filter in/out on a list, the element type of the list is {@link FileListItem}
		 * @callback fileListFilter
		 * @memberOf SFTP
		 * @param {string} parentPath the path of parent folder 
		 * @param {SFTP.FileListItem} item the name of the file
		 * @returns {boolean} if true then process otherwise drop
		 *
		*/
		/** 
		 * A function to collect and process items of a list, the element type of the list is {@link FileListItem}
		 * @callback fileItemCollector
		 * @memberOf SFTP
		 * @param {string} parentPath the path of parent folder 
		 * @param {SFTP.FileListItem} item the name of the file
		*/

		/**
		 * Add operation list to sftp operation queue
		 * @memberOf SFTP
		 * @instance
		 * @param {string} path the remote path to list
		 * @param {object} [opts] options object for list operation
		 * @param {SFTP.fileListFilter} [opts.filter] a function. If the return result is true the item will be collected otherwise it will be dropped.
		 * @param {SFTP.fileItemCollector} [opts.collector] a function. which used to process the file items.
		 */
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
		/**
		 * @memberOf SFTP
		 * @instance
		 * @param {string} path the remote path to traverse over 
		 * @param {object} [opts]  options object for traverse operation
		 * @param {boolean} [opts.processLinkedDirectory=false] Traverse on a symbol link directory or not, current not support symbol link directory process
		 * @param {boolean} [opts.processLinkedFile=false] Collect a symbol link file or not, current not support symbol link file process
		 * @param {boolean} [opts.collectDirectory=false] Also pass the direcotry matches by filter to collector function
		 * @param {SFTP.fileListFilter} [opts.traverseFilter] a function applies on all directory objects. Traverse will apply on the directory, if the function returns true.
		 * @param {SFTP.fileListFilter} [opts.collectFilter] a function applies on all normal file objects. The file will be collect and process, if the function returns true.
		 * @param {SFTP.fileItemCollector} [opts.collector] a function. which used to process the file items.
		 */
		traverseFolder(path, opts = {}) {
			let collector = function (p,f) {
				if (opts.collector) {
					opts.collector(p,f)
				} else {
					console.log(`${p}${p.match(/.*\/$/) ? '' : '/'}${f.filename}`);
				}
			}
			let traverseFilter = function (p,f) {
				if (opts.traverseFilter) {
					return opts.traverseFilter(p,f);
				} else {
					return true;
				}
			}
			let collectFilter=function(p,f){
                if(opts.collectFilter){
					return opts.collectFilter(p,f);
				}else{
					return true;
				}
			}
			let collectorFun = function (t, p) {
				return function (f) {
					let p1 = `${p}${p.match(/.*\/$/) ? '' : '/'}${f.filename}`;
					if (f.attrs.isDirectory()) {
						if (opts.collectDirectory&&collectFilter(p,f)) {
							collector(p,f);
						}
						if (traverseFilter(p,f)) {
							t.listFolder(p1, {
								collector: collectorFun(t, p1)
							});
						}
					}else if(f.attrs.isFile()){
                        if(collectFilter(p,f)){
							collector(p,f);
						}
					}
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
		if ((m & 0o770000) == mode) {
			return true;
		}
	}
	return false;
}
module.exports = SFTP;