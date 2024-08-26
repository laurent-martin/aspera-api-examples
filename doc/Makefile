DIR_TOP=$(PWD)/../
include $(DIR_TOP)common.mak
# create template from actual private config file
DOC_TOOL=ruby -I $(DIR_TOP)/doc -r doc -e
$(CONFIG_TMPL): $(CONFIG_FILE)
	$(DOC_TOOL) generate_config_template $(CONFIG_FILE) $@
all:: $(CONFIG_TMPL)
clean::
	rm -f $(CONFIG_TMPL)
