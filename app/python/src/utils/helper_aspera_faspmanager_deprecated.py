#!/usr/bin/env python3
# laurent.martin.aspera@fr.ibm.com
# Helper function to use legacy Fasp Manager for python
# 	curl -s http://download.asperasoft.com/download/sw/sdk/faspmanager/python/faspmanager-sdk-python-3.7.2-d787953b521f059412ad1713afaa38ccbb760a47.zip -o $(CONFIG_FSMGR_DIR)/faspmanager-sdk-python-3.7.2.zip
# 	openssl rsa -passin pass:743128bf-3bf3-45b5-ab14-4602c67f2950 -in aspera_tokenauth_id_rsa -out $(CONFIG_SDK_ROOT)/aspera_ssh_bypass_rsa.pem

import logging
import json
import base64
import copy
import os
import faspmanager
import sys

# this is part of redistributable
ASPERA_SSH_BYPASS_ABS_PATH = os.path.join(
    os.environ['CONFIG_SDK_ROOT'], 'aspera_ssh_bypass_rsa.pem'
)

assert 'CONFIG_FSMGR_DIR' in os.environ, 'env var CONFIG_FSMGR_DIR is missing'
# tell where to find legacy faspmanager lib
sys.path.insert(1, os.environ['CONFIG_FSMGR_DIR'])


def is_processed(t_spec, t_field):
    del t_spec[t_field]


def ignore_field(t_spec, t_field):
    if t_field in t_spec:
        is_processed(t_spec, t_field)


# optionally copy from one dict to another, and then delete from source
def opt_copy(dst, dk, t_spec, t_field):
    if t_field in t_spec:
        if t_spec[t_field] is not None:
            dst[dk] = t_spec[t_field]
        is_processed(t_spec, t_field)


# the Aspera FaspManager python library do not support directly transfer_spec
# This function translates transfer spec to transfer order suitable for faspmanager.session
# add translations when you need more args, the list is not complete here
def ts_to_order(t_spec):
    t_spec = copy.deepcopy(t_spec)
    # global ASPERA_SSH_BYPASS_ABS_PATH
    logging.debug('transfer spec: %s', t_spec)
    # transfer options: transfer_options.py
    xfer_opts = {}
    order_args = {}
    if 'token' in t_spec and not 'EX_ssh_key_path' in t_spec:
        t_spec['EX_ssh_key_path'] = ASPERA_SSH_BYPASS_ABS_PATH
    # translate generic transfer spec to python transfer options
    # those options names are the same as transfer_spec
    opt_copy(xfer_opts, 'cipher', t_spec, 'cipher')
    opt_copy(xfer_opts, 'cookie', t_spec, 'cookie')
    opt_copy(xfer_opts, 'token', t_spec, 'token')
    opt_copy(xfer_opts, 'destination_root', t_spec, 'destination_root')
    opt_copy(xfer_opts, 'min_rate_kbps', t_spec, 'min_rate_kbps')
    opt_copy(xfer_opts, 'target_rate_kbps', t_spec, 'target_rate_kbps')
    opt_copy(xfer_opts, 'delete_before_transfer', t_spec, 'delete_before_transfer')
    opt_copy(xfer_opts, 'exclude_older_than', t_spec, 'exclude_older_than')
    opt_copy(xfer_opts, 'exclude_newer_than', t_spec, 'exclude_newer_than')
    opt_copy(xfer_opts, 'multi_session_threshold', t_spec, 'multi_session_threshold')
    opt_copy(xfer_opts, 'precalculate_job_size', t_spec, 'precalculate_job_size')
    opt_copy(xfer_opts, 'preserve_access_time', t_spec, 'preserve_access_time')
    opt_copy(xfer_opts, 'preserve_acls', t_spec, 'preserve_acls')
    opt_copy(xfer_opts, 'preserve_creation_time', t_spec, 'preserve_creation_time')
    opt_copy(
        xfer_opts, 'preserve_modification_time', t_spec, 'preserve_modification_time'
    )
    opt_copy(xfer_opts, 'remove_empty_directories', t_spec, 'remove_empty_directories')
    opt_copy(xfer_opts, 'symlink_policy', t_spec, 'symlink_policy')

    # some have different name
    opt_copy(xfer_opts, 'source_prefix', t_spec, 'source_root')
    opt_copy(xfer_opts, 'policy', t_spec, 'rate_policy')
    opt_copy(xfer_opts, 'tcp_port', t_spec, 'ssh_port')
    opt_copy(xfer_opts, 'udp_port', t_spec, 'fasp_port')
    opt_copy(xfer_opts, 'check_ssh_fingerprint', t_spec, 'sshfp')
    opt_copy(xfer_opts, 'create_dirs', t_spec, 'create_dir')
    opt_copy(xfer_opts, 'datagram_size', t_spec, 'dgram_size')
    opt_copy(xfer_opts, 'move_after_transfer_path', t_spec, 'move_after_transfer')
    opt_copy(xfer_opts, 'overwrite_policy', t_spec, 'overwrite')
    opt_copy(xfer_opts, 'preserve_dates', t_spec, 'preserve_times')
    opt_copy(xfer_opts, 'resume_check', t_spec, 'resume_policy')

    # no transfer spec standard for the following options
    opt_copy(
        xfer_opts, 'alternate_config_filename', t_spec, 'EX_alternate_config_filename'
    )
    opt_copy(xfer_opts, 'apply_local_docroot', t_spec, 'EX_apply_local_docroot')
    opt_copy(xfer_opts, 'auto_detect_capacity', t_spec, 'EX_auto_detect_capacity')
    # true/false, use 'cipher'node/...
    opt_copy(xfer_opts, 'encryption', t_spec, 'EX_encryption')
    opt_copy(xfer_opts, 'file_checksum', t_spec, 'EX_file_checksum')
    opt_copy(xfer_opts, 'file_manifest_format', t_spec, 'EX_file_manifest_format')
    opt_copy(xfer_opts, 'file_manifest_path', t_spec, 'EX_file_manifest_path')
    opt_copy(xfer_opts, 'ignore_host_key', t_spec, 'EX_ignore_host_key')
    opt_copy(xfer_opts, 'local_log_dir', t_spec, 'EX_local_log_dir')
    opt_copy(xfer_opts, 'remote_log_dir', t_spec, 'EX_remote_log_dir')
    opt_copy(xfer_opts, 'partial_file_suffix', t_spec, 'EX_partial_file_suffix')
    opt_copy(xfer_opts, 'pre_post_command_path', t_spec, 'EX_pre_post_command_path')
    opt_copy(xfer_opts, 'preserve_file_owner_gid', t_spec, 'EX_preserve_file_owner_gid')
    opt_copy(xfer_opts, 'preserve_file_owner_uid', t_spec, 'EX_preserve_file_owner_uid')
    opt_copy(
        xfer_opts,
        'preserve_source_access_time',
        t_spec,
        'EX_preserve_source_access_time',
    )
    opt_copy(xfer_opts, 'preserve_xattrs', t_spec, 'EX_preserve_xattrs')
    opt_copy(xfer_opts, 'read_size', t_spec, 'EX_read_size')
    opt_copy(xfer_opts, 'remote_preserve_acls', t_spec, 'EX_remote_preserve_acls')
    opt_copy(xfer_opts, 'remote_preserve_xattrs', t_spec, 'EX_remote_preserve_xattrs')
    opt_copy(xfer_opts, 'remove_empty_source_dir', t_spec, 'EX_remove_empty_source_dir')
    opt_copy(
        xfer_opts,
        'remove_files_after_transfer',
        t_spec,
        'EX_remove_files_after_transfer',
    )
    opt_copy(
        xfer_opts,
        'retransmission_request_max_size',
        t_spec,
        'EX_retransmission_request_max_size',
    )
    opt_copy(xfer_opts, 'retry_timeout', t_spec, 'EX_retry_timeout')
    opt_copy(xfer_opts, 'save_before_overwrite', t_spec, 'EX_save_before_overwrite')
    opt_copy(xfer_opts, 'skip_dir_traversal_dups', t_spec, 'EX_skip_dir_traversal_dups')
    opt_copy(xfer_opts, 'skip_special_files', t_spec, 'EX_skip_special_files')
    opt_copy(xfer_opts, 'source_base', t_spec, 'EX_source_base')
    opt_copy(xfer_opts, 'exclude_patterns', t_spec, 'EX_exclude_patterns')
    opt_copy(xfer_opts, 'write_size', t_spec, 'EX_write_size')
    opt_copy(xfer_opts, 'chunk_size', t_spec, 'EX_chunk_size')
    opt_copy(
        xfer_opts,
        'content_protection_passphrase',
        t_spec,
        'EX_content_protection_passphrase',
    )
    opt_copy(xfer_opts, 'extra_options', t_spec, 'EX_ascp_args')
    # for 'tags' use EX_ascp_args = ['--tags64','base64 of tags']
    if 'tags' in t_spec and t_spec['tags'] is not None:
        if not 'extra_options' in xfer_opts:
            xfer_opts['extra_options'] = []
        xfer_opts['extra_options'].append('--tags64')
        xfer_opts['extra_options'].append(
            base64.b64encode(json.dumps(t_spec['tags']).encode('ascii'))
        )
    ignore_field(t_spec, 'tags')
    if 'destination' in t_spec['paths'][0]:
        order_args['dest_paths'] = []
    order_args['source_paths'] = []
    for p in t_spec['paths']:
        order_args['source_paths'].append(p['source'])
        if 'dest_paths' in order_args:
            order_args['dest_paths'].append(p['destination'])
    ignore_field(t_spec, 'paths')
    # those are not supported (returned by faspex)
    ignore_field(t_spec, 'target_rate_cap_kbps')
    ignore_field(t_spec, 'rate_policy_allowed')
    ignore_field(t_spec, 'lock_rate_policy')
    ignore_field(t_spec, 'lock_min_rate')
    ignore_field(t_spec, 'fasp_url')
    ignore_field(t_spec, 'min_rate_cap_kbps')
    logging.debug('options args: %s', xfer_opts)
    if 'http_fallback' in t_spec:
        if t_spec['http_fallback']:
            http_fb_opts = {}
            opt_copy(http_fb_opts, 'http_port', t_spec, 'http_fallback_port')
            opt_copy(
                http_fb_opts, 'https_key_filename', t_spec, 'EX_https_key_filename'
            )
            opt_copy(
                http_fb_opts, 'https_cert_filename', t_spec, 'EX_https_cert_filename'
            )
            opt_copy(
                http_fb_opts,
                'http_proxy_address_host',
                t_spec,
                'EX_http_proxy_address_host',
            )
            opt_copy(
                http_fb_opts,
                'http_proxy_address_port',
                t_spec,
                'EX_http_proxy_address_port',
            )
            opt_copy(
                http_fb_opts, 'encode_all_as_jpeg', t_spec, 'EX_http_transfer_jpeg'
            )
            xfer_opts['http_fallback_options'] = faspmanager.HttpFallbackOptions(
                **http_fb_opts
            )
        ignore_field(t_spec, 'http_fallback')
    # no direction, as the call is directly FileUpload or FileDownload
    if t_spec['direction'] == 'send':
        opt_copy(order_args, 'dest_user', t_spec, 'remote_user')
        opt_copy(order_args, 'dest_host', t_spec, 'remote_host')
        opt_copy(order_args, 'dest_pass', t_spec, 'remote_password')
        opt_copy(order_args, 'dest_identity', t_spec, 'EX_ssh_key_path')
        order_args['options'] = faspmanager.TransferOptions(**xfer_opts)
        logging.debug('order args: %s', order_args)
        transferJob = faspmanager.FileUpload(**order_args)
    elif t_spec['direction'] == 'receive':
        opt_copy(order_args, 'source_user', t_spec, 'remote_user')
        opt_copy(order_args, 'source_host', t_spec, 'remote_host')
        opt_copy(order_args, 'source_pass', t_spec, 'remote_password')
        opt_copy(order_args, 'source_identity', t_spec, 'EX_ssh_key_path')
        order_args['options'] = faspmanager.TransferOptions(**xfer_opts)
        logging.debug('order args: %s', order_args)
        transferJob = faspmanager.FileDownload(**order_args)
    else:
        raise Exception('direction must be send or receive')
    ignore_field(t_spec, 'direction')
    for k in t_spec:
        logging.error('unknown tspec : %s (%s)', k, t_spec[k])
    return transferJob


# helper function that starts a transfer from transfer spec, and waits for completion
# transfer spec can be found here:
# https://developer.ibm.com/api/view/aspera-prod:ibm-aspera:title-IBM_Aspera#113565  in response model
# https://developer.ibm.com/api/view/aspera-prod:ibm-aspera:title-IBM_Aspera#113458  in start new transfer
# https://www.rubydoc.info/gems/asperalm#Transfer_Parameters
# feel free to use only ts_to_order and faspmanager.session
def start_transfer_and_wait(t_spec):
    # create session, start and wait for completion
    with faspmanager.session(ts_to_order(t_spec)) as session:
        session.start()
        result = session.finish()
        logging.debug('Transfer complete. Result: {}'.format(result))
        if not result.ok():
            logging.debug('Failure reason: {}'.format(result.reason()))
            logging.debug('Failed files: {}'.format(result.failed_files()))


def start_transfer_and_wait(t_spec):
    logging.debug(t_spec)
    helper_aspera_faspmanager.start_transfer_and_wait(t_spec)
