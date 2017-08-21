var fs = require('fs'),
    os = require('os');

module.exports = {
    POOL: 'tank',
    maxAge: '259200',
    backupNodes: [],
    backupFilesDir: os.homedir() + '/.backupFiles',
    sshKey: fs.readFileSync(os.homedir() + '/.ssh/id_rsa').toString(),
};
