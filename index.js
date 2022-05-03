import fs from 'fs';
import path from 'path';
import 'dotenv/config';
const {
    mode
} = process.env;
// Bring in the ability to create the 'require' method
import { createRequire } from "module";
import { fileURLToPath } from 'url';

import express from 'express';
import connectLivereload from 'connect-livereload';
import _ from 'lodash';

import {
    credentialsFromBasicAuth,
    authenticate
} from './authorization.js';
import {
    isUrl,
    isNotUrl,
    getHead,
    getHtml,
    parseDom,
    extractFileUri
} from './linkinPark.js';
import { PurgeCSS } from "purgecss";
import purgecssWordpress from 'purgecss-with-wordpress';

import {
    JSDOM,
    VirtualConsole
} from 'jsdom';
import fetch from 'node-fetch';

import reductionFactor from './reductionFactor.js';

// construct the require method
const require = createRequire( import.meta.url );

// Solves: "__dirname is not defined in ES module scope"
const __filename = fileURLToPath( import.meta.url );
const __dirname = path.dirname( __filename );

const bodyParser = require( 'body-parser' );
const livereload = require( 'livereload' );

if ( mode === 'production' ) {
    // haha y'all don't work now.
    console.log = () => { };
    console.warn = () => { };
    console.error = () => { };
    console.dir = () => { };
}

const app = express();
const port = 6969;

// open livereload high port and start to watch public directory for changes
const liveReloadServer = livereload.createServer();
liveReloadServer.watch( path.resolve( __dirname, 'public' ) );

// ping browser on Express boot, once browser has reconnected and handshaken
liveReloadServer.server.once( "connection", () => {
    setTimeout( () => {
        liveReloadServer.refresh( "/" );
    }, 100 );
} );

// monkey patch every served HTML so they know of changes
app.use( connectLivereload() );

app.use( bodyParser.urlencoded( { extended: true } ) );
app.use( bodyParser.json() );

app.listen( port );

app.get( '/', ( req, res ) => {
    res.send( 'Well, yes, but actually no.' );
} );

app.post( '/', async ( req, res ) => {
    const [
        username,
        password
    ] = credentialsFromBasicAuth( req );

    const ok = authenticate( username, password );

    if ( !ok ) {
        res.status( 401 ).send( 'Authentication failed.' );
    }

    const target = req?.body?.target;
    if ( !target ) {
        res.status( 422 ).send( 'Must provide a target URL.' );
    }

    console.log( 'Getting HTML' );

    const testHtml = await getHtml( `https://${target}/` );
    if ( !fs.existsSync( './temp_test/' ) ) fs.mkdirSync( './temp_test/' );
    fs.writeFileSync(
        path.resolve( './temp_test/temp_test.html' ),
        testHtml
    );

    const virtualConsole = new VirtualConsole();
    virtualConsole.on( "error", () => {
        // No-op to skip console errors.
    } );
    // Get them stylesheet links.
    const dom = new JSDOM( testHtml, { virtualConsole } );
    if ( !dom ) {
        res.status( 500 ).send( 'Failed to create vDOM. :c' );
    }

    console.log( 'Finding stylesheets' );

    const links = Array.from( dom.window.document.querySelectorAll( 'link[rel="stylesheet"]' ) );
    if ( !links ) {
        res.status( 500 ).send( 'No <link>s found. :c' );
    }

    console.log( 'Downloading CSS' );

    for ( const l of links ) {
        if ( !isUrl( l.href ) ) {
            console.error( 'Error: not a url!', l.href );
            continue;
        }
        const response = await fetch( l.href );
        if ( response.status === 200 ) {
            let fileUri = extractFileUri( l.href );
            if ( !fileUri ) {
                fileUri = _.uniqueId( Date.now() );
            }
            const data = await response.text();
            fs.writeFileSync(
                path.resolve( `./temp_test/temp_${fileUri}.css` ),
                data
            );
        }
    }

    console.log( 'Purging CSS' );

    const result = await ( new PurgeCSS() ).purge( {
        content: ['./temp_test/**/*.html'],
        css: ['./temp_test/**/*.css'],
        safelist: purgecssWordpress.safelist
    } );
    if ( !result ) {
        res.status( 500 ).send( 'Failed to purge. :c' );
    }

    console.log( 'Writing purged stylesheet' );

    let css = '';
    if ( !fs.existsSync( './temp_test/purged/' ) ) fs.mkdirSync( './temp_test/purged/' );
    for ( const stylesheet of result ) {
        css += stylesheet.css;
        fs.writeFileSync(
            path.resolve( `./temp_test/purged/${extractFileUri( stylesheet.file )}.purged.css` ),
            stylesheet.css
        );
    }

    console.log( 'Calculating reduction factor' );

    const rf = reductionFactor();

    // cleanup!
    fs.rmSync(
        './temp_test/',
        {
            recursive: true,
            force: true
        }
    );

    res.json( {
        reductionFactor: rf,
        css: css
    } );
} );