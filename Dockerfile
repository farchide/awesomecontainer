FROM ubuntu

RUN DEBIAN_FRONTEND=noninteractive apt update -y && \
    DEBIAN_FRONTEND=noninteractive apt install -y python3 python3-pip mongodb git && \
    pip3 install prancer-basic

CMD prancer
WORKDIR /prancer/project