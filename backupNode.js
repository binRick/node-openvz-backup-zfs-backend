#!/usr/bin/env node

var spawn = require('child_process').spawn,
    moment = require('moment'),
    pj = require('prettyjson'),
    prettyBytes = require('pretty-bytes'),
    prettyMs = require('pretty-ms'),
    condenseWhitespace = require('condense-whitespace'),
    ora = require('ora'),
    clear = require('cli-clear'),
    Client = require('ssh2').Client,
    fs = require('fs'),
    c = require('chalk'),
    async = require('async'),
    _ = require('underscore'),
    os = require('os'),
    config = require('./config');

var NODE = process.argv[2],
    VEID = process.argv[3] || '',
    POOL = config.POOL,
    maxAge = config.maxAge,
    backupNodes = config.backupNodes,
    sshPort = config.sshPort,
    vzList = '',
    backupFilesDir = config.backupFilesDir,
    sshKey = config.sshKey,
    nodeConnection = {
        host: NODE,
        port: sshPort,
        username: 'root',
        privateKey: sshKey,
        readyTimeout: 5000,
    },
    snapshots = '';


var spinner = ora('Querying local snapshots...').start();
var snapList = spawn('zfs', ['list', '-tsnapshot', '-pHoname']);
snapList.on('exit', function(code) {
    if (code != 0) process.exit(code);
    snapshots = snapshots.split('\n').filter(function(s) {
        var sa = s.split('/');
        return sa[2] == NODE;
    });
    spinner.succeed('Loaded ' + +snapshots.length + ' snapshots for node ' + NODE + '...');
    try {
        var skipVeids = fs.readFileSync('/etc/skipveids').split('\n').filter(function(v) {
            return v;
        });
    } catch (e) {
        var skipVeids = [];
    }
    try {
        fs.statSync(backupFilesDir);
    } catch (e) {
        fs.mkdirSync(backupFilesDir);
    }
    spinner = ora('Querying ' + NODE + ' for non disabled VMs to back up...').start();
    var conn = new Client();
    conn.on('error', function() {
        spinner.fail('Connection to ' + NODE + ' failed.');
        process.exit();
    });
    conn.on('ready', function() {
        conn.exec('/usr/sbin/vzlist -ajo veid,private,root,status,disabled ' + VEID, function(err, stream) {
            if (err) throw err;
            stream.on('close', function(code, signal) {
                if (code != 0) {
                    spinner.fail('Connection to ' + NODE + ' failed.');
                    process.exit();
                }
                conn.end();
                var vzListJson = JSON.parse(vzList).filter(function(vm) {
                    return vm.disabled == false;
                });
                spinner.succeed('Connection to ' + NODE + ' OK! Queried ' + vzListJson.length + ' VMs.');
                async.mapSeries(vzListJson, function(vmJson, _cb) {
                    spinner = ora('  Working on VM ' + vmJson.veid + '....');
                    var privateFilesystem = '';
                    var conn2 = new Client();
                    conn2.on('ready', function() {
                        conn2.exec('df ' + vmJson.private, function(err, stream2) {
                            if (err) throw err;
                            stream2.on('close', function(code, signal) {
                                if (code != 0) throw code;
                                conn2.end();
                                vmJson.privateFilesystem = condenseWhitespace(privateFilesystem.split('\n')[1]).split(' ')[0];
                                var privateFilesystemType = '';
                                var conn3 = new Client();
                                conn3.on('ready', function() {
                                    conn3.exec('grep "^' + vmJson.privateFilesystem + ' " /proc/mounts', function(err, stream3) {
                                        if (err) throw err;
                                        stream3.on('close', function(code, signal) {
                                            if (code != 0) throw code;
                                            conn3.end();
                                            vmJson.privateFilesystemType = condenseWhitespace(privateFilesystemType).split(' ')[2];
                                            vmJson.snapshots = snapshots.filter(function(s) {
                                                var sa = s.split('@')[0].split('/');
                                                return sa[0] == POOL && sa[sa.length - 1] == vmJson.veid;
                                            }).map(function(s) {
                                                snapshot = s.split('@')[1].split('-');
                                                var date = snapshot[snapshot.length - 4] + '-' + snapshot[snapshot.length - 3] + '-' + snapshot[snapshot.length - 2] + '-' + snapshot[snapshot.length - 1];
                                                var timestamp = Math.round(moment(date, 'YYYY-MM-DD-HHmm Z').valueOf() / 1000);
                                                var now = Math.round(moment().utc().valueOf() / 1000);
                                                var age = now - timestamp;
                                                return {
                                                    snapshot: s,
                                                    timestamp: timestamp,
                                                    age: age,
                                                    tooOld: age > maxAge ? true : false,
                                                };
                                            });
                                            vmJson.tooOld = true;
                                            _.each(vmJson.snapshots, function(s) {
                                                if (s.tooOld == false)
                                                    vmJson.tooOld = false;
                                            });
vmJson.destination = {
	pool: POOL,
	fs: POOL+'/Backups/'+NODE+'/'+vmJson.veid,
};

                                            console.log(pj.render(vmJson));
                                            spinner.succeed('  Finished working on VM ' + vmJson.veid + '.');
                                            _cb(null, vmJson);
                                        }).on('data', function(data) {
                                            privateFilesystemType += data.toString();
                                        });
                                    });
                                }).connect(nodeConnection);
                            }).on('data', function(data) {
                                privateFilesystem += data.toString();
                            });
                        });
                    }).connect(nodeConnection);
                }, function(errs, vzListJson) {
                    if (errs) throw errs;
                    console.log('Completed Processing ' + vzListJson.length + ' VMs..');
                });
            }).on('data', function(data) {
                vzList += data.toString();
            }).stderr.on('data', function(data) {});
        });
    }).connect(nodeConnection);
}).stdout.on('data', function(data) {
    snapshots += data.toString();
});
