/*!
 * Yamlinc
 * Copyright(c) 2016-2018 Javanile.org
 * MIT Licensed
 */

var fs = require("fs"),
    realpath = require("fs").realpathSync,
    dirname = require("path").dirname,
    basename = require("path").basename,
    join = require("path").join,
    merge = require("deepmerge"),
    yamljs = require("yamljs"),
    helpers = require("./helpers"),
    cuid = require('cuid'),
    EOL = require('os').EOL;

var chokidar = require("chokidar");

module.exports = {

    /**
     *
     */
    mute: false,

    /**
     *
     */
    watcherEnabled: false,

    /**
     *
     */
    spawnRunning: false,

    /**
     *
     */
    includeTag: '$include',

    /**
     *
     */
    escapeTag: '\\$include',

    /**
     * Command line entry-point.
     *
     * @param {array} args a list of arguments
     * @returns {string}
     */
    run: function (args, callback) {
        if (typeof args == "undefined" || !args || args.length === 0) {
            return helpers.error("Arguments error", "type: yamlinc --help");
        }

        //
        var options = {
            '--mute': 'setMute'
        }
        for (option in options) {
            if (args.indexOf(option) > -1) {
                this[options[option]](args);
                args.splice(args.indexOf(option), 1);
            }
        }

        //
        var commands = {
            '--help': 'getHelp',
            '--version': 'getVersion',
            '--watch': 'runCommandWatch',
            '--exec': 'runCommandExec'
        }
        for (command in commands) {
            if (args.indexOf(command) > -1) {
                return this[commands[command]](args);
            }
        }

        // looking for file in parameters
        var file = null;
        for (var i in args) {
            if (!args.hasOwnProperty(i)) {
                continue;
            }
            if (args[i].charAt(0) != "-" && args[i].match(/\.yml$/)) {
                file = args[i];
                args.splice(i, 1);
                break;
            }
        }

        //
        if (!file) {
            return helpers.error("Arguments error", "missing file name.");
        }

        //
        var fileInc = this.getFileInc(file);

        // Compile yaml files
        this.compile(file, fileInc);
    },

    /**
     *
     */
    getFileInc: function (file) {
        //return join(process.cwd(), basename(file).replace(/\.yml$/, '.inc.yml'));
        return basename(file).replace(/\.yml$/, '.inc.yml');
    },

    /**
     *
     * @param file
     * @returns {*}
     */
    resolve: function(file)
    {
        var yamlinc = this;
        var base = dirname(file);
        var code = fs.readFileSync(file).toString()
            .replace(this.getRegExpIncludeTag(), function (tag) {
                return tag.replace(yamlinc.includeTag, yamlinc.includeTag + '_' + cuid());
            });
        var data = yamljs.parse(code);

        this.recursiveResolve(data, base);

        return data;
    },

    /**
     * Walk through array and find include tag.
     *
     * @param array  $yaml       reference of an array
     * @param string $includeTag tag to include file
     */
    recursiveResolve: function(data, base) {
        if (typeof data !== 'object') {
            return;
        }
        var includes = {};
        for (var key in data) {
            if (this.isKeyMatchIncludeTag(key)) {
                if (typeof data[key] === "string" && data[key]) {
                    file = base + '/' + data[key];
                    if (file && fs.existsSync(file)) {
                        helpers.info("Include", file);
                        var include = this.resolve(file);
                        includes = Object.assign(includes, merge(includes, include));
                    }
                } else if (typeof data[key] === "object") {
                    for (var index in data[key]) {
                        file = base + '/' + data[key][index];
                        if (file && fs.existsSync(file)) {
                            helpers.info("Include", file);
                            var include = this.resolve(file);
                            includes = Object.assign(includes, merge(includes, include));
                        }
                    }
                }
                delete data[key];
                continue;
            }
            this.recursiveResolve(data[key], base);
        }

        if (includes && Object.keys(includes).length) {
            data = Object.assign(data, merge(data, includes));
        }

        return data;
    },

    /**
     *
     */
    runCommandWatch: function (args) {
        var yamlinc = this;
        args.splice(args.indexOf("--watch"), 1);

        var file = null;
        var fileInc = null;
        for (var i in args) {
            if (!args.hasOwnProperty(i)) { continue; }
            if (args[i].charAt(0) != "-" && args[i].match(/\.yml$/)) {
                file = args[i];
                fileInc = this.getFileInc(file);
                args[i] = fileInc;
                break;
            }
        }

        var watcher = chokidar.watch("./**/*.yml", {
            persistent: true,
            usePolling: true
        });

        this.compile(file, fileInc);

        var cmd = args.shift();

        watcher
            .on('change', function(change) { yamlinc.handleFileChange(change, file, fileInc, cmd, args); })
            .on('unlink', function(change) { yamlinc.handleFileChange(change, file, fileInc, cmd, args); });

        setTimeout(function() {
            watcher.on('add', function(change) {
                yamlinc.handleFileChange(change, file, fileInc, cmd, args);
            });
        }, 15000);

        setTimeout(function(){
            yamlinc.watcherEnabled = true;
            yamlinc.spawnLoop(cmd, args);
        }, 1000);
    },

    /**
     *
     */
    runCommandExec: function (args) {
        var yamlinc = this;
        args.splice(args.indexOf("--exec"), 1);

        var file = null;
        var fileInc = null;
        for (var i in args) {
            if (!args.hasOwnProperty(i)) { continue; }
            if (args[i].charAt(0) != "-" && args[i].match(/\.yml$/)) {
                file = args[i];
                fileInc = this.getFileInc(file);
                args[i] = fileInc;
                break;
            }
        }

        this.compile(file, fileInc);

        var cmd = args.shift();

        helpers.info('Command', cmd + ' ' + args.join(' '));
        helpers.spawn(cmd, args);
    },

    /**
     *
     */
    spawnLoop: function (cmd, args) {
        if (this.spawnRunning) { return; }

        var yamlinc = this;
        this.spawnRunning = true;
        helpers.info('Command', cmd + ' ' + args.join(' '));
        helpers.spawn(cmd, args, function(){
            yamlinc.spawnRunning = false;
        });
    },


    /**
     *
     */
    handleFileChange: function (change, file, fileInc, cmd, args) {
        if (!this.watcherEnabled || change.match(/\.inc\.yml$/)) { return; }
        helpers.info('Changed', change);
        this.compile(file, fileInc);
        if (!this.spawnRunning) {
            this.spawnLoop(cmd, args);
        }
    },

    /**
     * Compile Yaml file
     */
    compile: function (file, fileInc) {
        if (!fs.existsSync(file)) {
            return helpers.error("File error", "file '"+file+"' not found.");
        }

        //
        helpers.info("Analize", file);
        var data = this.resolve(file);
        var disclaimer = [
            "## --------------------",
            "## DON'T EDIT THIS FILE",
            "## --------------------",
            "## Engine: " + this.getVersion(),
            "## Source: " + file,
        ];

        helpers.info("Compile", fileInc);
        fs.writeFileSync(fileInc, disclaimer.join(EOL) + EOL + EOL + yamljs.stringify(data, 10));
    },

    /**
     *
     */
    getRegExpIncludeTag: function () {
        return new RegExp('^[ \\t]*' + this.escapeTag + '[ \\t]*:', 'gmi');
    },

    /**
     *
     * @param key
     * @param includeTag
     * @returns {Array|{index: number, input: string}|*}
     */
    isKeyMatchIncludeTag: function (key) {
        return key.match(new RegExp('^' + this.escapeTag + '_[a-z0-9]{25}$'));
    },

    /**
     * Get sotware help.
     *
     * @param args
     */
    setMute: function (args) {
        this.mute = true;
        helpers.mute = true;
    },

    /**
     * Get sotware help.
     *
     * @param args
     */
    getHelp: function (args) {
        var help = join(__dirname, "../help/help.txt");
        return console.log(fs.readFileSync(help)+"");
    },

    /**
     * Get software version.
     *
     * @param args
     */
    getVersion: function () {
        var info = JSON.parse(fs.readFileSync(join(__dirname, "../package.json")), "utf8");
        return info.name + "@" + info.version;
    }
};
