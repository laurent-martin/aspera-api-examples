DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.make
SRC=src/
PYTMP=$(TMPDIR)/pythontst/
all: aoc$(T) cos$(T) cos2$(T) cos_node_api$(T) faspex$(T) faspex5$(T) node$(T) server$(T)
%$(T): $(IS_OK)
	$(SRC)$$(basename $@ $(T)).py $(PYTMP)This_is_a_test.txt
	sleep 2
	touch $@
../$(IS_OK):
	cd .. && make
$(IS_OK): ../$(IS_OK)
	pip3 install -r $(SRC)requirements.txt
	mkdir -p $(PYTMP)
	date > $(PYTMP)This_is_a_test.txt
	dd of=$(PYTMP)1G.bin bs=1k seek=$$((1024*1024)) count=0
	touch $@
clean:
	test -n "$(T)" && rm -f *$(T)
	rm -f $(IS_OK)
	rm -fr $(PYTMP)
	find . -name __pycache__ -o -name '*.pyc'|xargs rm -fr
