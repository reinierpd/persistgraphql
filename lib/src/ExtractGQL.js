"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var path = require("path");
var sha256 = require("hash.js/lib/hash/sha/256");
var yaml = require("js-yaml");
var graphql_1 = require("graphql");
var extractFromAST_1 = require("./extractFromAST");
var extractFromJS_1 = require("./extractFromJS");
var common_1 = require("./common");
var queryTransformers_1 = require("./queryTransformers");
var _ = require("lodash");
var ExtractGQL = (function () {
    function ExtractGQL(_a) {
        var inputFilePath = _a.inputFilePath, _b = _a.outputFilePath, outputFilePath = _b === void 0 ? 'extracted_queries.json' : _b, _c = _a.queryTransformers, queryTransformers = _c === void 0 ? [] : _c, extension = _a.extension, _d = _a.toObjects, toObjects = _d === void 0 ? false : _d, _e = _a.useHash, useHash = _e === void 0 ? false : _e;
        this.queryId = 0;
        this.queryTransformers = [];
        this.toObjects = false;
        this.useHash = false;
        this.literalTag = 'gql';
        this.inputFilePath = inputFilePath;
        this.outputFilePath = outputFilePath;
        this.queryTransformers = queryTransformers;
        if (extension && extension[0] && extension[0] !== '') {
            this.extension = (extension);
        }
        else {
            this.extension = ['graphql'];
        }
        this.toObjects = toObjects;
        this.useHash = useHash;
    }
    ExtractGQL.getFileExtension = function (filePath) {
        var pieces = path.basename(filePath).split('.');
        if (pieces.length <= 1) {
            return '';
        }
        return pieces[pieces.length - 1];
    };
    ExtractGQL.readFile = function (filePath) {
        return new Promise(function (resolve, reject) {
            fs.readFile(filePath, 'utf8', function (err, data) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(data);
                }
            });
        });
    };
    ExtractGQL.isDirectory = function (_path) {
        return new Promise(function (resolve, reject) {
            fs.stat(_path, function (err, stats) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(stats.isDirectory());
                }
            });
        });
    };
    ExtractGQL.generateHash = function (query) {
        return (sha256()
            .update(query)
            .digest('hex'));
    };
    ExtractGQL.prototype.addQueryTransformer = function (queryTransformer) {
        this.queryTransformers.push(queryTransformer);
    };
    ExtractGQL.prototype.applyQueryTransformers = function (document) {
        return common_1.applyQueryTransformers(document, this.queryTransformers);
    };
    ExtractGQL.prototype.getQueryKey = function (definition) {
        return common_1.getQueryKey(definition, this.queryTransformers);
    };
    ExtractGQL.prototype.getQueryDocumentKey = function (document) {
        return common_1.getQueryDocumentKey(document, this.queryTransformers);
    };
    ExtractGQL.prototype.createMapFromDocument = function (document) {
        var _this = this;
        var transformedDocument = this.applyQueryTransformers(document);
        var queryDefinitions = extractFromAST_1.getOperationDefinitions(transformedDocument);
        var mapResult = {};
        var arrayResult = [];
        queryDefinitions.forEach(function (transformedDefinition) {
            var transformedQueryWithFragments = _this.getQueryFragments(transformedDocument, transformedDefinition);
            transformedQueryWithFragments.definitions.unshift(transformedDefinition);
            var docQueryKey = _this.getQueryDocumentKey(transformedQueryWithFragments);
            if (_this.toObjects) {
                var queryId = ExtractGQL.generateHash(docQueryKey);
                var RE = /(?:query|mutation)\s+(\w+)\s*[({]/;
                var matches = RE.exec(docQueryKey);
                arrayResult.push({
                    queryName: matches ? matches[1] : queryId.slice(0, 10),
                    queryId: queryId,
                    active: true,
                    query: docQueryKey,
                });
            }
            else {
                if (_this.useHash) {
                    mapResult[docQueryKey] = ExtractGQL.generateHash(docQueryKey);
                }
                else {
                    mapResult[docQueryKey] = _this.getQueryId();
                }
            }
        });
        return this.toObjects ? arrayResult : mapResult;
    };
    ExtractGQL.prototype.processGraphQLFile = function (graphQLFile) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            ExtractGQL.readFile(graphQLFile).then(function (fileContents) {
                var graphQLDocument = graphql_1.parse(fileContents);
                resolve(_this.createMapFromDocument(graphQLDocument));
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    ExtractGQL.prototype.createOutputMapFromString = function (docString) {
        var _this = this;
        var doc = graphql_1.parse(docString);
        var docMap = graphql_1.separateOperations(doc);
        var resultMaps = Object.keys(docMap).map(function (operationName) {
            var document = docMap[operationName];
            return _this.createMapFromDocument(document);
        });
        if (this.toObjects) {
            return [].concat.apply([], resultMaps);
        }
        else {
            return _.merge.apply(_, [{}].concat(resultMaps));
        }
    };
    ExtractGQL.prototype.readGraphQLFile = function (graphQLFile) {
        return ExtractGQL.readFile(graphQLFile);
    };
    ExtractGQL.prototype.readInputFile = function (inputFile) {
        var _this = this;
        return Promise.resolve().then(function () {
            var extension = ExtractGQL.getFileExtension(inputFile);
            if (_this.extension.includes(extension)) {
                if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
                    return ExtractGQL.readFile(inputFile).then(function (result) {
                        var literalContents = extractFromJS_1.findTaggedTemplateLiteralsInJS(result, _this.literalTag);
                        var noInterps = literalContents.map(extractFromJS_1.eliminateInterpolations);
                        var joined = noInterps.join('\n');
                        return joined;
                    });
                }
                else {
                    return _this.readGraphQLFile(inputFile);
                }
            }
            else {
                return '';
            }
        });
    };
    ExtractGQL.prototype.processInputPath = function (inputPath) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.readInputPath(inputPath).then(function (docString) {
                resolve(_this.createOutputMapFromString(docString));
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    ExtractGQL.prototype.readInputPath = function (inputPath) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            ExtractGQL.isDirectory(inputPath).then(function (isDirectory) {
                if (isDirectory) {
                    console.log("Crawling " + inputPath + "...");
                    fs.readdir(inputPath, function (err, items) {
                        if (err) {
                            reject(err);
                        }
                        var promises = items.map(function (item) {
                            return _this.readInputPath(inputPath + '/' + item);
                        });
                        Promise.all(promises).then(function (queryStrings) {
                            resolve(queryStrings.reduce(function (x, y) { return x + y; }, ''));
                        });
                    });
                }
                else {
                    _this.readInputFile(inputPath).then(function (result) {
                        resolve(result);
                    }).catch(function (err) {
                        console.log("Error occurred in processing path " + inputPath + ": ");
                        console.log(err.message);
                        reject(err);
                    });
                }
            });
        });
    };
    ExtractGQL.prototype.getQueryFragments = function (document, queryDefinition) {
        var queryFragmentNames = extractFromAST_1.getFragmentNames(queryDefinition.selectionSet, document);
        var retDocument = {
            kind: 'Document',
            definitions: [],
        };
        var reduceQueryDefinitions = function (carry, definition) {
            var definitionName = definition.name;
            if ((extractFromAST_1.isFragmentDefinition(definition) && queryFragmentNames[definitionName.value] === 1)) {
                var definitionExists = carry.findIndex(function (value) { return value.name.value === definitionName.value; }) !== -1;
                if (!definitionExists) {
                    return carry.concat([definition]);
                }
            }
            return carry;
        };
        retDocument.definitions = document.definitions.reduce(reduceQueryDefinitions, []).sort(common_1.sortFragmentsByName);
        return retDocument;
    };
    ExtractGQL.prototype.getQueryId = function () {
        this.queryId += 1;
        return this.queryId;
    };
    ExtractGQL.prototype.writeOutputMap = function (outputMap, outputFilePath) {
        return new Promise(function (resolve, reject) {
            fs.open(outputFilePath, 'w+', function (openErr, fd) {
                if (openErr) {
                    reject(openErr);
                }
                var data;
                if (outputFilePath.endsWith('.yaml') || outputFilePath.endsWith('.yml')) {
                    data = yaml.safeDump({ queries: outputMap });
                }
                else {
                    data = JSON.stringify(outputMap);
                }
                fs.write(fd, data, function (writeErr, written, str) {
                    if (writeErr) {
                        reject(writeErr);
                    }
                    resolve();
                });
            });
        });
    };
    ExtractGQL.prototype.extract = function () {
        var _this = this;
        this.processInputPath(this.inputFilePath).then(function (outputMap) {
            _this.writeOutputMap(outputMap, _this.outputFilePath).then(function () {
                console.log("Wrote output file to " + _this.outputFilePath + ".");
            }).catch(function (err) {
                console.log("Unable to process ouput path " + _this.outputFilePath + ". Error message: ");
                console.log("" + err.message);
            });
        }).catch(function (err) {
            console.log("Unable to process input path " + _this.inputFilePath + ". Error message: ");
            console.log("" + err.message);
        });
    };
    return ExtractGQL;
}());
exports.ExtractGQL = ExtractGQL;
exports.main = function (argv) {
    var args = argv._;
    var inputFilePath;
    var outputFilePath;
    var queryTransformers = [];
    if (args.length < 1) {
        console.log('Usage: persistgraphql input_file [output_file]');
    }
    else if (args.length === 1) {
        inputFilePath = args[0];
    }
    else {
        inputFilePath = args[0];
        outputFilePath = args[1];
    }
    if (argv['add_typename']) {
        console.log('Using the add-typename query transformer.');
        queryTransformers.push(queryTransformers_1.addTypenameTransformer);
    }
    var options = {
        inputFilePath: inputFilePath,
        outputFilePath: outputFilePath,
        queryTransformers: queryTransformers,
    };
    if (argv['hash']) {
        options.useHash = true;
    }
    if (argv['to-objects']) {
        options.toObjects = true;
    }
    if (argv['extension']) {
        options.extension = argv['extension'].split(',');
    }
    new ExtractGQL(options).extract();
};
//# sourceMappingURL=ExtractGQL.js.map