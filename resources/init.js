/* eslint camelcase: ["error", {properties: "never"}] */
( function () {
	var sentryPromise;

	/**
	 * @return {jQuery.Deferred} a deferred with two values: the Raven.js object and the TraceKit
	 *   error handler
	 */
	function initSentry() {
		if ( !sentryPromise ) {
			sentryPromise = mw.loader.using( 'sentry.bundle' ).then( function () {
				var config = mw.config.get( 'wgSentry' ),
					options = {},
					oldOnError,
					traceKitOnError;

				// If EventGate is configured, this extension will send errors to it.
				// However, it needs to configure the sentry dsn to initialize Sentry
				if ( !config.dsn ) {
					mw.log.error( 'See README for how to configure Sentry server' );
				}

				if ( config.whitelist ) {
					options.whitelistUrls = config.whitelist.slice( 0 );
					options.whitelistUrls.push( location.host );
				}
				options.collectWindowErrors = config.logOnError;

				// Annoyingly, there is no way to install Sentry without it taking over
				// the global error handler (and chaining the old handler after itself).
				oldOnError = window.onerror;
				window.onerror = null;
				try {
					window.Sentry.init({ dsn: config.dsn });
					window.Sentry.configureScope(
						function( scope ) {
							scope.setExtra('version', mw.config.get( 'wgVersion' ));
							scope.setExtra('debug', mw.config.get( 'debug' ));
							scope.setExtra('skin', mw.config.get( 'skin' ));
							scope.setExtra('action', mw.config.get( 'wgAction' ));
							scope.setExtra('ns', mw.config.get( 'wgNamespaceNumber' ));
							scope.setExtra('page_name', mw.config.get( 'wgPageName' ));
							scope.setExtra('user_groups', mw.config.get( 'wgUserGroups' ));
							scope.setExtra('language', mw.config.get( 'wgUserLanguage' ));
						}
					);
				} catch ( e ) {
					window.onerror = oldOnError;
					mw.log.error( e );
					return $.Deferred().reject( e );
				}
				traceKitOnError = window.onerror;
				window.onerror = oldOnError;

				return $.Deferred().resolve( window.Sentry, traceKitOnError );
			} );
		}
		return sentryPromise;
	}

	/**
	 * @param {string} topic mw.track() queue name
	 * @param {Object} data
	 * @param {Mixed} data.exception The exception which has been caught
	 * @param {string} data.id An identifier for the exception
	 * @param {string} data.source Describes what type of function caught the exception
	 * @param {string} [data.module] Name of the module which threw the exception
	 * @param {Object} [data.context] Additional key-value pairs to be recorded as Sentry tags
	 */
	function report( topic, data ) {
		mw.sentry.initSentry().done( function () {
			window.Sentry.captureException( data.exception );
		} );
	}

	/**
	 * Handles global.error events.
	 *
	 * There is no way to stop Raven from replacing window.onerror (https://github.com/getsentry/raven-js/issues/316)
	 * and it will pass errors to the old handler after reporting them, so we need a temporary
	 * handler to avoid double reporting. This handler will load Raven the first time it is called,
	 * and handle errors until Raven is loaded; once that happens, Raven handles errors on its own
	 * and this handler needs to be removed.
	 *
	 * @param {string} topic mw.track() queue name
	 * @param {Object} data
	 */
	function handleGlobalError( topic, data ) {
		mw.sentry.initSentry().done( function ( sentry, traceKitOnError ) {
			traceKitOnError.call(
				window,
				data.errorMessage,
				data.url,
				data.lineNumber,
				data.columnNumber,
				data.errorObject
			);
		} );
	}

	// make these available for unit tests
	mw.sentry = { initSentry: initSentry, report: report };

	mw.trackSubscribe( 'resourceloader.exception', report );

	mw.trackSubscribe( 'global.error', handleGlobalError );

	mw.trackSubscribe( 'eventlogging.error', function ( topic, error ) {
		mw.sentry.initSentry().done( function () {
			window.Sentry.captureException( error, { source: 'EventLogging' } );
		} );
	} );
}() );
