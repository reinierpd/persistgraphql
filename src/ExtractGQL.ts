// This file implements the extractgql CLI tool.

import fs = require('fs');
import path = require('path');
import sha256 = require('hash.js/lib/hash/sha/256');
import yaml = require('js-yaml');

import {
  parse,
  DocumentNode,
  OperationDefinitionNode,
  FragmentDefinitionNode,
  DefinitionNode,
  separateOperations,
} from 'graphql';

import {
  getOperationDefinitions,
  getFragmentNames,
  isFragmentDefinition,
} from './extractFromAST';

import {
  findTaggedTemplateLiteralsInJS,
  eliminateInterpolations,
} from './extractFromJS';

import {
  getQueryKey,
  getQueryDocumentKey,
  sortFragmentsByName,
  applyQueryTransformers,
  OutputMap,
  OutputObject,
  QueryTransformer,
} from './common';

import {
  addTypenameTransformer,
} from './queryTransformers';

import _ = require('lodash');

export type ExtractGQLOptions = {
  inputFilePath: string,
  outputFilePath?: string,
  queryTransformers?: QueryTransformer[],
  extension?: string[],
  toObjects?: boolean,
  useHash?: boolean,
};

export class ExtractGQL {
  public inputFilePath: string;
  public outputFilePath: string;

  // Starting point for monotonically increasing query ids.
  public queryId: number = 0;

  // List of query transformers that a query is put through (left to right)
  // before being written as a transformedQuery within the OutputMap.
  public queryTransformers: QueryTransformer[] = [];

  // The file extension to load queries from
  public extension: string[];

  // Do we output as objects
  public toObjects: boolean = false;

  // Whether to use id or use a hash of the query
  public useHash: boolean = false;

  // The template literal tag for GraphQL queries in JS code
  public literalTag: string = 'gql';

  // Given a file path, this returns the extension of the file within the
  // file path.
  public static getFileExtension(filePath: string): string {
    const pieces = path.basename(filePath).split('.');
    if (pieces.length <= 1) {
      return '';
    }
    return pieces[pieces.length - 1];
  }

  // Reads a file into a string.
  public static readFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  // Checks if a given path points to a directory.
  public static isDirectory(_path: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      fs.stat(_path, (err, stats) => {
        if (err) {
          reject(err);
        } else {
          resolve(stats.isDirectory());
        }
      });
    });
  }

  public static generateHash(query: string): string {
    return (
      sha256()
        .update(query)
        .digest('hex')
    );
  }

  constructor({
    inputFilePath,
    outputFilePath = 'extracted_queries.json',
    queryTransformers = [],
    extension,
    toObjects = false,
    useHash = false,
  }: ExtractGQLOptions) {
    this.inputFilePath = inputFilePath;
    this.outputFilePath = outputFilePath;
    this.queryTransformers = queryTransformers;
    if (extension && extension[0] && extension[0] !== '') {
      this.extension = (extension);
    } else {
      this.extension = ['graphql'];
    }
    this.toObjects = toObjects;
    this.useHash = useHash;
  }

  // Add a query transformer to the end of the list of query transformers.
  public addQueryTransformer(queryTransformer: QueryTransformer) {
    this.queryTransformers.push(queryTransformer);
  }

  // Applies this.queryTransformers to a query document.
  public applyQueryTransformers(document: DocumentNode) {
    return applyQueryTransformers(document, this.queryTransformers);
  }

  // Just calls getQueryKey with this.queryTransformers as its set of
  // query transformers and returns a serialization of the query.
  public getQueryKey(definition: OperationDefinitionNode): string {
    return getQueryKey(definition, this.queryTransformers);
  }

  // Just calls getQueryDocumentKey with this.queryTransformers as its
  // set of query transformers and returns a serialization of the query.
  public getQueryDocumentKey(
    document: DocumentNode,
  ): string {
    return getQueryDocumentKey(document, this.queryTransformers);
  }

  // Create an OutputMap from a GraphQL document that may contain
  // queries, mutations and fragments.
  public createMapFromDocument(document: DocumentNode): OutputMap | OutputObject[] {
    const transformedDocument = this.applyQueryTransformers(document);
    const queryDefinitions = getOperationDefinitions(transformedDocument);
    const mapResult: OutputMap = {};
    const arrayResult: OutputObject[] = [];
    queryDefinitions.forEach((transformedDefinition) => {
      const transformedQueryWithFragments = this.getQueryFragments(
        transformedDocument,
        transformedDefinition,
      );
      transformedQueryWithFragments.definitions.unshift(transformedDefinition);
      const docQueryKey = this.getQueryDocumentKey(
        transformedQueryWithFragments,
      );
      if (this.toObjects) {
        const queryId = ExtractGQL.generateHash(docQueryKey);
        const RE = /(?:query|mutation)\s+(\w+)\s*[({]/;
        const matches = RE.exec(docQueryKey);

        arrayResult.push({
          queryName: matches ? matches[1] : queryId.slice(0, 10),
          queryId,
          active: true,
          query: docQueryKey,
        });
      } else {
        if (this.useHash) {
          mapResult[docQueryKey] = ExtractGQL.generateHash(docQueryKey);
        } else {
          mapResult[docQueryKey] = this.getQueryId();
        }
      }
    });
    return this.toObjects ? arrayResult : mapResult;
  }

  // Given the path to a particular `.graphql` file, read it, extract the queries
  // and return the promise to an OutputMap. Used primarily for unit tests.
  public processGraphQLFile(graphQLFile: string): Promise<OutputMap | OutputObject[]> {
    return new Promise<OutputMap | OutputObject[]>((resolve, reject) => {
      ExtractGQL.readFile(graphQLFile).then((fileContents) => {
        const graphQLDocument = parse(fileContents);

        resolve(this.createMapFromDocument(graphQLDocument));
      }).catch((err) => {
        reject(err);
      });
    });
  }

  // Creates an OutputMap from an array of GraphQL documents read as strings.
  public createOutputMapFromString(docString: string): OutputMap | OutputObject[] {
    const doc = parse(docString);
    const docMap = separateOperations(doc);

    const resultMaps = Object.keys(docMap).map((operationName) => {
      const document = docMap[operationName];
      return this.createMapFromDocument(document);
    });

    if (this.toObjects) {
      return [].concat(...resultMaps) as OutputObject[];
    } else {
      return (_.merge({} as OutputMap, ...resultMaps) as OutputMap);
    }
  }

  public readGraphQLFile(graphQLFile: string): Promise<string> {
    return ExtractGQL.readFile(graphQLFile);
  }

  public readInputFile(inputFile: string): Promise<string> {
    return Promise.resolve().then(() => {
      const extension = ExtractGQL.getFileExtension(inputFile);

      if (this.extension.includes(extension)) {
        if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
          // Read from a JS file
          return ExtractGQL.readFile(inputFile).then((result) => {
            const literalContents = findTaggedTemplateLiteralsInJS(result, this.literalTag);
            const noInterps = literalContents.map(eliminateInterpolations);
            const joined = noInterps.join('\n');
            return joined;
          });
        } else {
          return this.readGraphQLFile(inputFile);
        }
      } else {
        return '';
      }
    });
  }

  // Processes an input path, which may be a path to a GraphQL file
  // or a directory containing GraphQL files. Creates an OutputMap
  // instance from these files.
  public processInputPath(inputPath: string): Promise<OutputMap | OutputObject[]> {
    return new Promise<OutputMap | OutputObject[]>((resolve, reject) => {
      this.readInputPath(inputPath).then((docString: string) => {
        resolve(this.createOutputMapFromString(docString));
      }).catch((err) => {
        reject(err);
      });
    });
  }

  public readInputPath(inputPath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      ExtractGQL.isDirectory(inputPath).then((isDirectory) => {
        if (isDirectory) {
          console.log(`Crawling ${inputPath}...`);
          // Recurse over the files within this directory.
          fs.readdir(inputPath, (err, items) => {
            if (err) {
              reject(err);
            }
            const promises: Promise<string>[] = items.map((item) => {
              return this.readInputPath(inputPath + '/' + item);
            });

            Promise.all(promises).then((queryStrings: string[]) => {
              resolve(queryStrings.reduce((x, y) => x + y, ''));
            });
          });
        } else {
          this.readInputFile(inputPath).then((result: string) => {
            resolve(result);
          }).catch((err) => {
            console.log(`Error occurred in processing path ${inputPath}: `);
            console.log(err.message);
            reject(err);
          });
        }
      });
    });
  }

  // Takes a document and a query definition contained within that document. Then, extracts
  // the fragments that the query depends on from the document and returns a document containing
  // only those fragments.
  public getQueryFragments(document: DocumentNode, queryDefinition: OperationDefinitionNode): DocumentNode {
    const queryFragmentNames = getFragmentNames(queryDefinition.selectionSet, document);
    const retDocument: DocumentNode = {
      kind: 'Document',
      definitions: [],
    };

    const reduceQueryDefinitions = (carry: FragmentDefinitionNode[], definition: DefinitionNode) => {
      const definitionName = (definition as (FragmentDefinitionNode | OperationDefinitionNode)).name;
      if ((isFragmentDefinition(definition) && queryFragmentNames[definitionName.value] === 1)) {
        const definitionExists = carry.findIndex(
          (value: FragmentDefinitionNode) => value.name.value === definitionName.value,
        ) !== -1;

        // If this definition doesn't exist yet, add it.
        if (!definitionExists) {
          return [...carry, definition];
        }
      }

      return carry;
    };

    retDocument.definitions = document.definitions.reduce(
      reduceQueryDefinitions,
      ([] as FragmentDefinitionNode[]),
    ).sort(sortFragmentsByName);

    return retDocument;
  }

  // Returns unique query ids.
  public getQueryId() {
    this.queryId += 1;
    return this.queryId;
  }

  // Writes an OutputMap to a given file path.
  public writeOutputMap(outputMap: OutputMap | OutputObject[], outputFilePath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      fs.open(outputFilePath, 'w+', (openErr, fd) => {
        if (openErr) { reject(openErr); }

        let data;
        if (outputFilePath.endsWith('.yaml') || outputFilePath.endsWith('.yml')) {
          data = yaml.safeDump({queries: outputMap});
        } else {
          data = JSON.stringify(outputMap);
        }

        fs.write(fd, data, (writeErr, written, str) => {
          if (writeErr) { reject(writeErr); }
          resolve();
        });
      });
    });
  }

  // Extracts GraphQL queries from this.inputFilePath and produces
  // an output JSON file in this.outputFilePath.
  public extract() {
    this.processInputPath(this.inputFilePath).then((outputMap: OutputMap) => {
      this.writeOutputMap(outputMap, this.outputFilePath).then(() => {
        console.log(`Wrote output file to ${this.outputFilePath}.`);
      }).catch((err) => {
        console.log(`Unable to process ouput path ${this.outputFilePath}. Error message: `);
        console.log(`${err.message}`);
      });
    }).catch((err) => {
      console.log(`Unable to process input path ${this.inputFilePath}. Error message: `);
      console.log(`${err.message}`);
    });
  }
}

// Type for the argument structure provided by the "yargs" library.
export interface YArgsv {
  _: string[];
  [ key: string ]: any;
}

// Main driving method for the command line tool
export const main = (argv: YArgsv) => {
  // These are the unhypenated arguments that yargs does not process
  // further.
  const args: string[] = argv._;
  let inputFilePath: string;
  let outputFilePath: string;
  const queryTransformers: QueryTransformer[] = [];

  if (args.length < 1) {
    console.log('Usage: persistgraphql input_file [output_file]');
  } else if (args.length === 1) {
    inputFilePath = args[0];
  } else {
    inputFilePath = args[0];
    outputFilePath = args[1];
  }

  // Check if we are passed "--add_typename", if we are, we have to
  // apply the typename query transformer.
  if (argv['add_typename']) {
    console.log('Using the add-typename query transformer.');
    queryTransformers.push(addTypenameTransformer);
  }

  const options: ExtractGQLOptions = {
    inputFilePath,
    outputFilePath,
    queryTransformers,
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
