library identifier: 'utils@master', retriever: modernSCM(
  [$class: 'GitSCMSource',
   remote: 'https://github.com/farchide/my-jenkins-utils.git'])

@Library('utils') _

pipeline {
    agent none
    stage ('Example') {
        steps {
            // log.info 'Starting' 
            script { 
                log.info 'Starting'
                log.warning 'Nothing to do!'
            }
        }
    }
}