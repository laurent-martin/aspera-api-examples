all::
# must have trailing slash
WEB_ROOT=./webroot/
# retrieve javascript libs for http gateway client
http-gateway.js:
	mkdir -p tmp_node
	npm --prefix tmp_node install --save @ibm-aspera/http-gateway-sdk-js
	mv tmp_node/node_modules/@ibm-aspera/http-gateway-sdk-js/js/http-gateway.js $(WEB_ROOT)
	rm -fr tmp_node
# run the server
all:: http-gateway.js
	npm install
	node --trace-warnings src/server.js ../config.yaml 3000 $(WEB_ROOT)
clean:
	rm -f package-lock.json conf.js $(WEB_ROOT)http-gateway.js
	rm -f aspera-httpgw-example.zip
	rm -fr node_modules
zip:
	zip aspera-httpgw-example.zip $$(git ls-files)
