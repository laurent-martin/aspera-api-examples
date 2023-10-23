# test file to transfer, here generated file, but could be real file with a path
FILE_TRANSFER=faux:///100m?100m
all: .is_tested
.is_tested:
	npm install
	cd .. && make startdaemon&
	node server.js '$(FILE_TRANSFER)'
	node server_v2.js '$(FILE_TRANSFER)'
	cd .. && make stopdaemon
	touch $@
clean:
	rm -f .is_tested package-lock.json
	rm -fr node_modules tmp
