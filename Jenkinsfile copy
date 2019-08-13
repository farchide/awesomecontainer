pipeline {
  agent any

  environment {
    // global variable
    FOO = "PIPELINE"
  }

  stages {
    stage("SCM") {
      steps {
        git url: 'https://github.com/farchide/awesomecontainer.git'      }
    }
    stage("local") {
      environment {
        // BAR will only be available in this stage
        BAR = "STAGE"
      }
      steps {
        sh 'echo "FOO is $FOO and BAR is $BAR"'
      }
    }
    stage("global") {
      steps {
        sh 'echo "FOO is $FOO and BAR is $BAR"'
      }
    }
  }
}