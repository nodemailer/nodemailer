'use strict';

module.exports = function (grunt) {
    // Project configuration.
    grunt.initConfig({
        eslint: {
            all: ['index.js', 'lib/**/*.js', 'test/**/*.js', 'examples/**/*.js', 'Gruntfile.js']
        },

        mochaTest: {
            all: {
                options: {
                    reporter: 'spec'
                },
                src: ['test/**/*-test.js']
            }
        }
    });

    // Load the plugin(s)
    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-mocha-test');

    // Tasks
    grunt.registerTask('default', ['eslint', 'mochaTest']);
};
