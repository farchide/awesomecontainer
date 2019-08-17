#build
docker build . --tag myazcli 

#run
docker run -it mcr.microsoft.com/azure-cli

#update
docker pull mcr.microsoft.com/azure-cli

#uninstall
docker rmi mcr.microsoft.com/azure-cli

#remove all the stopped docker
docker system prune

#list container
docker container ls -a
#remove
docker container rm cc3f2ff51cab cd20b396a061
docker image rm 75835a67d134 2a4cca5ac898

