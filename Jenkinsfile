myLib=library (identifier: 'utils@master', retriever: modernSCM(
    [$class: 'GitSCMSource',
        remote: 'https://github.com/farchide/my-jenkins-utils.git',
        includes: '*',
        excludes: 'test'
    ]))


pipeline {
    agent none
    stages {
        stage ('Example') {
            steps {
                // log.info 'Starting' 
                script { 
                    myLib.log.info 'Starting'
                    myLib.log.warning 'Nothing to do!'
                }
            }
        }
    }
}