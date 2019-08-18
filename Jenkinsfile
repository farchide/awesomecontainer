pipeline {
    agent {
        docker { image 'mcr.microsoft.com/azure-cli' }
    }
    stages {
        stage('Test') {
            steps {
                sh 'hostname -f'
                sh 'chmod -R 755 .azure'
                sh 'az --version'
            }
        }
    }
}