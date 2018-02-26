var SFTP = require('../lib/sftp.js');
var server = new SFTP();
var utils = SFTP.utils;
console.log("server:" + server);
console.log("utils:" + utils.isFile);