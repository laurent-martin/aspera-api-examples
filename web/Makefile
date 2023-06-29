all::
# run make to start server
# this retrieves javascript libs for http gateway client
dist/http-gateway.js:
	mkdir -p dist
	npm --prefix dist install --save @ibm-aspera/http-gateway-sdk-js
	mv dist/node_modules/@ibm-aspera/http-gateway-sdk-js/js/http-gateway.js* dist
	rm -fr dist/node_modules dist/package*.json
node_modules:
	npm install
conf.js: ../config.yaml node_modules
	node script/convert.js ../config.yaml > $@
# run the server
all:: node_modules dist/http-gateway.js conf.js
	PATH="/opt/homebrew/bin:$$PATH" node --trace-warnings src/server.js ../config.yaml 3000 .
	@echo "open "
clean:
	rm -f package-lock.json conf.js
	rm -f aspera-httpgw-example.zip
	rm -fr dist node_modules
	-killall asperatransferd
zip:
	zip aspera-httpgw-example.zip $$(git ls-files)
