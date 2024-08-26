# must have trailing slash
DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.mak
SRC=./src/
TMP_NPM=tmp_node/
GW_SDK=@ibm-aspera/http-gateway-sdk-js
DK_SDK=@ibm-aspera/desktop-sdk-js
CN_SDK=@ibm-aspera/connect-sdk-js
all:: $(IS_OK)
	node --trace-warnings src/server.js $(SRC)
# retrieve javascript libs for http gateway client
$(SRC)http-gateway.js:
	mkdir -p $(TMP_NPM)
	npm install $(GW_SDK) --save --prefix $(TMP_NPM)
	mv $(TMP_NPM)node_modules/$(GW_SDK)/js/http-gateway.js $(SRC)
	rm -fr $(TMP_NPM)
# run the server
$(IS_OK): $(SRC)http-gateway.js
	npm install
	@touch $@
clean::
	rm -f package-lock.json $(SRC)conf.js $(SRC)http-gateway.js
	rm -f aspera-httpgw-example.zip
	rm -fr node_modules
zip:
	zip aspera-httpgw-example.zip $$(git ls-files)
test: $(T)webserver
$(T)webserver: $(IS_OK)
	make &
	sleep 5
	killall node
	@touch $@
