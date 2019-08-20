pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile.build'
            dir 'build'
        }
    }
    stages {
        stage('dockerlint test') {
            steps {
                sh 'node --version'
                sh 'dockerlint Dockerfile'
            }
        }
    }
}
