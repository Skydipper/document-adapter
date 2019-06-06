module.exports = function (grunt) {

    grunt.file.setBase('..');
    require('load-grunt-tasks')(grunt);

    grunt.initConfig({

        clean: {},
        express: {
            dev: {
                options: {
                    script: 'app/index.js',
                    node_env: 'dev',
                    port: process.env.PORT,
                    output: 'started'
                }
            }
        },
        mochaTest: {
            unit: {
                options: {
                    reporter: 'spec',
                    quiet: false, // Optionally suppress output to standard out (defaults to false)
                    clearRequireCache: true // Optionally clear the require cache before running tests (defaults to false)
                },
                src: ['app/test/unit/**/*.test.js']
            },
            e2e: {
                options: {
                    reporter: 'spec',
                    quiet: false,
                    timeout: 30000,
                    clearRequireCache: true,
                },
                src: ['app/test/e2e/**/*.spec.js']
            }
        },
        watch: {
            options: {
                livereload: true
            },
            jssrc: {
                files: [
                    'app/src/**/*.js',
                ],
                tasks: ['express'],
                options: {
                    spawn: false
                }
            }
        },
        nyc: {
            cover: {
                options: {
                    include: ['app/src/**'],
                    exclude: '*.test.*',
                    reporter: ['lcov', 'text-summary'],
                    reportDir: 'coverage',
                    all: true
                },
                cmd: false,
                args: ['grunt', '--gruntfile', 'app/Gruntfile.js', 'mochaTest:e2e']
            }
        }
    });


    grunt.registerTask('e2eTest', ['express', 'mochaTest:e2e']);

    grunt.registerTask('test', ['mochaTest:unit', 'mochaTest:e2e']);

    grunt.registerTask('serve', ['express', 'watch']);

    grunt.registerTask('default', 'serve');

    grunt.loadNpmTasks('grunt-simple-nyc');

};
