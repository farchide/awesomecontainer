pipeline {
    agent any 
    stages {
        stage('checkout from git') { 
            steps {
                //git branch: 'develop', credentialsId: 'bb-login', url: 'https://bitbucket.org/[name-goes-here]/[sample].git'
                git url: 'https://github.com/farchide/awesomecontainer.git'
            }
        }
        stage('Test') { 
            steps {
                // 
                ls
            }
        }
        stage('Deploy') { 
            steps {
                // 
                ls
            }
        }
    }
}