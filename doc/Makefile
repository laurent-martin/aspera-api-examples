ifndef DIR_PANDOC
$(error The environment variable DIR_PANDOC is not set. Please set it and try again.)
endif
include $(DIR_PANDOC)pandoc.mak

DIR_TOP=$(CURDIR)/../
include $(DIR_TOP)common.mak
# create template from actual private config file
DOC_TOOL=ruby -I $(DIR_TOP)/doc -r doc -e
$(GBL_FILE_CONF_TMPL): $(GBL_FILE_CONFIG)
	$(DOC_TOOL) generate_config_template $(GBL_FILE_CONFIG) $@
all:: $(GBL_FILE_CONF_TMPL) README.pdf
clean::
	rm -f $(GBL_FILE_CONF_TMPL)
pdf: README.pdf
