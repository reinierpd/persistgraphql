import { DocumentNode, OperationDefinitionNode } from 'graphql';
import { OutputMap, OutputObject, QueryTransformer } from './common';
export declare type ExtractGQLOptions = {
    inputFilePath: string;
    outputFilePath?: string;
    queryTransformers?: QueryTransformer[];
    extension?: string[];
    toObjects?: boolean;
    useHash?: boolean;
};
export declare class ExtractGQL {
    inputFilePath: string;
    outputFilePath: string;
    queryId: number;
    queryTransformers: QueryTransformer[];
    extension: string[];
    toObjects: boolean;
    useHash: boolean;
    literalTag: string;
    static getFileExtension(filePath: string): string;
    static readFile(filePath: string): Promise<string>;
    static isDirectory(_path: string): Promise<boolean>;
    static generateHash(query: string): string;
    constructor({ inputFilePath, outputFilePath, queryTransformers, extension, toObjects, useHash, }: ExtractGQLOptions);
    addQueryTransformer(queryTransformer: QueryTransformer): void;
    applyQueryTransformers(document: DocumentNode): DocumentNode;
    getQueryKey(definition: OperationDefinitionNode): string;
    getQueryDocumentKey(document: DocumentNode): string;
    createMapFromDocument(document: DocumentNode): OutputMap | OutputObject[];
    processGraphQLFile(graphQLFile: string): Promise<OutputMap | OutputObject[]>;
    createOutputMapFromString(docString: string): OutputMap | OutputObject[];
    readGraphQLFile(graphQLFile: string): Promise<string>;
    readInputFile(inputFile: string): Promise<string>;
    processInputPath(inputPath: string): Promise<OutputMap | OutputObject[]>;
    readInputPath(inputPath: string): Promise<string>;
    getQueryFragments(document: DocumentNode, queryDefinition: OperationDefinitionNode): DocumentNode;
    getQueryId(): number;
    writeOutputMap(outputMap: OutputMap | OutputObject[], outputFilePath: string): Promise<void>;
    extract(): void;
}
export interface YArgsv {
    _: string[];
    [key: string]: any;
}
export declare const main: (argv: YArgsv) => void;
