DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.make
SRC=src/
PYTMP=$(TMPDIR)/pythontst/
TSTFILE=$(PYTMP)This_is_a_test.txt
all:: $(T)aoc $(T)cos $(T)cos2 $(T)cos_node_api $(T)faspex $(T)faspex5 $(T)node $(T)server
$(T)%: $(IS_OK)
	@echo "Running test $@"
	name='$@' && $(SRC)$${name#$(T)}.py $(TSTFILE)
	sleep 2
	@touch $@
# ensure SDK is there
../$(IS_OK):
	cd .. && make
$(IS_OK): ../$(IS_OK)
	pip3 install -r $(SRC)requirements.txt
	mkdir -p $(PYTMP)
	date > $(TSTFILE)
	dd of=$(PYTMP)1G.bin bs=1k seek=$$((1024*1024)) count=0
	@touch $@
clean: clean_flags
	rm -fr $(PYTMP)
	find . -name __pycache__ -o -name '*.pyc'|xargs rm -fr
