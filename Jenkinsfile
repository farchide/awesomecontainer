pipeline {
    agent {
        docker { image 'mcr.microsoft.com/azure-cli' }
    }
    stages {
        stage('Test') {
            steps {
                sh 'hostname -f'
                sh 'az --version'
            }
        }
    }
}