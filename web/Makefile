all::
# must have trailing slash
WEB_ROOT=./src/
# retrieve javascript libs for http gateway client
$(WEB_ROOT)http-gateway.js:
	mkdir -p tmp_node
	npm --prefix tmp_node install --save @ibm-aspera/http-gateway-sdk-js
	mv tmp_node/node_modules/@ibm-aspera/http-gateway-sdk-js/js/http-gateway.js $(WEB_ROOT)
	rm -fr tmp_node
# run the server
all:: .is_initialized $(WEB_ROOT)http-gateway.js
	node --trace-warnings src/server.js $(WEB_ROOT)
.is_initialized:
	npm install
	touch $@
clean:
	rm -f package-lock.json $(WEB_ROOT)conf.js $(WEB_ROOT)http-gateway.js
	rm -f aspera-httpgw-example.zip
	rm -fr node_modules
	rm -f .is_initialized .is_tested
zip:
	zip aspera-httpgw-example.zip $$(git ls-files)
test: .is_tested
.is_tested: .is_initialized
	make &
	sleep 5
	killall node
	touch $@

