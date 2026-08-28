#define _DEFAULT_SOURCE
#define _POSIX_C_SOURCE 200809L

#include <cautest/kernel_abi.h>
#include <cautest/ctp3.h>

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/reboot.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define AGENT_MAX_CATALOG 32U
#define AGENT_MAX_ENDPOINT 64U
#define AGENT_MAX_PATH 256U
#define AGENT_MAX_BUILD_ID 128U
#define AGENT_MAX_DESCRIPTORS 256U
#define AGENT_LINE CTP3_TX_LINE_MAX

struct catalog_entry {
    char endpoint[AGENT_MAX_ENDPOINT];
    char type[16];
    char build_id[AGENT_MAX_BUILD_ID];
    char path[AGENT_MAX_PATH];
};

struct catalog {
    char build_id[AGENT_MAX_BUILD_ID];
    struct catalog_entry entries[AGENT_MAX_CATALOG];
    size_t count;
};

struct kernel_descriptor {
    uint32_t suite_id;
    uint32_t case_id;
    uint32_t param_id;
    uint32_t registry_id;
    uint32_t descriptor_id;
    uint32_t kernel_suite_id;
    char suite[CAUTEST_KERNEL_NAME_MAX];
    char case_name[CAUTEST_KERNEL_NAME_MAX];
    char parameter[CAUTEST_KERNEL_NAME_MAX];
};

static int read_all(int fd, void *target, size_t size)
{
    unsigned char *cursor = target;
    while (size) {
        ssize_t count = read(fd, cursor, size);
        if (count == 0) return 1;
        if (count < 0) { if (errno == EINTR) continue; return -1; }
        cursor += count;
        size -= (size_t)count;
    }
    return 0;
}

static int write_all(int fd, const void *source, size_t size)
{
    const unsigned char *cursor = source;
    while (size) {
        ssize_t count = write(fd, cursor, size);
        if (count < 0) { if (errno == EINTR) continue; return -1; }
        cursor += count;
        size -= (size_t)count;
    }
    return 0;
}

static int read_command(int fd, char *line, size_t capacity)
{
    size_t size = 0;
    for (;;) {
        unsigned char byte;
        if (read_all(fd, &byte, 1)) return -1;
        if (byte == '\n') {
            if (size && line[size - 1] == '\r') --size;
            line[size] = '\0';
            return 0;
        }
        if (size + 1 >= capacity) {
            while (byte != '\n') {
                if (read_all(fd, &byte, 1)) break;
            }
            return -2;
        }
        line[size++] = (char)byte;
    }
}

static void abi_header(struct cautest_kernel_abi_header *header, size_t size)
{
    header->abi_major = CAUTEST_KERNEL_ABI_MAJOR;
    header->abi_minor = CAUTEST_KERNEL_ABI_MINOR;
    header->struct_size = (__u32)size;
}

static int load_catalog(const char *path, struct catalog *catalog)
{
    FILE *file = fopen(path, "r");
    char line[1024];
    if (!file) return -1;
    memset(catalog, 0, sizeof(*catalog));
    while (fgets(line, sizeof(line), file)) {
        char *newline = strchr(line, '\n');
        if (newline) *newline = '\0';
        if (!strncmp(line, "build_id=", 9)) {
            if (strlen(line + 9) >= sizeof(catalog->build_id)) { fclose(file); return -1; }
            strcpy(catalog->build_id, line + 9);
            continue;
        }
        if (!line[0] || line[0] == '#') continue;
        if (catalog->count >= AGENT_MAX_CATALOG) { fclose(file); return -1; }
        {
            struct catalog_entry *entry = &catalog->entries[catalog->count];
            size_t existing;
            char *endpoint = strtok(line, "\t");
            char *type = strtok(NULL, "\t");
            char *build_id = strtok(NULL, "\t");
            char *target = strtok(NULL, "\t");
            if (!endpoint || !type || !build_id || !target || strtok(NULL, "\t")) { fclose(file); return -1; }
            if (strlen(endpoint) >= sizeof(entry->endpoint) || strlen(type) >= sizeof(entry->type) || strlen(build_id) >= sizeof(entry->build_id) || strlen(target) >= sizeof(entry->path)) { fclose(file); return -1; }
            strcpy(entry->endpoint, endpoint);
            strcpy(entry->type, type);
            strcpy(entry->build_id, build_id);
            strcpy(entry->path, target);
            for (existing = 0; existing < catalog->count; ++existing)
                if (!strcmp(catalog->entries[existing].endpoint, entry->endpoint)) { fclose(file); return -1; }
            catalog->count++;
        }
    }
    fclose(file);
    return catalog->build_id[0] && catalog->count ? 0 : -1;
}

static struct catalog_entry *catalog_find(struct catalog *catalog,
                                          const char *endpoint)
{
    size_t index;
    for (index = 0; index < catalog->count; ++index)
        if (!strcmp(catalog->entries[index].endpoint, endpoint))
            return &catalog->entries[index];
    return NULL;
}

static int line_append(char *line, size_t capacity, size_t *size,
                       const char *text)
{
    while (*text) {
        unsigned char byte = (unsigned char)*text++;
        const char *escape = NULL;
        char hex[5];
        if (byte == '\\') escape = "\\\\";
        else if (byte == ',') escape = "\\,";
        else if (byte == '\n') escape = "\\n";
        else if (byte == '\r') escape = "\\r";
        else if (byte < 0x20 || byte == 0x7f) {
            static const char digits[] = "0123456789ABCDEF";
            hex[0] = '\\'; hex[1] = 'x'; hex[2] = digits[byte >> 4];
            hex[3] = digits[byte & 15]; hex[4] = '\0'; escape = hex;
        }
        if (escape) {
            size_t length = strlen(escape);
            if (*size + length >= capacity) return -1;
            memcpy(line + *size, escape, length); *size += length;
        } else {
            if (*size + 1 >= capacity) return -1;
            line[(*size)++] = (char)byte;
        }
    }
    return 0;
}

static int line_append_escaped(char *line, size_t capacity, size_t *size,
                               const char *text)
{
    static const char hex[] = "0123456789ABCDEF";
    while (*text) {
        unsigned char byte = (unsigned char)*text++;
        const char *escape = NULL;
        if (byte == '\\') escape = "\\\\";
        else if (byte == ',') escape = "\\,";
        else if (byte == '\n') escape = "\\n";
        else if (byte == '\r') escape = "\\r";
        if (escape) {
            if (line_append(line, capacity, size, escape)) return -1;
        } else if (byte < 0x20U || byte == 0x7fU) {
            if (*size + 4 >= capacity) return -1;
            line[(*size)++] = '\\'; line[(*size)++] = 'x';
            line[(*size)++] = hex[byte >> 4];
            line[(*size)++] = hex[byte & 0x0fU];
        } else {
            if (*size + 1 >= capacity) return -1;
            line[(*size)++] = (char)byte;
        }
    }
    return 0;
}

static int send_line(int fd, const char *format, ...)
{
    char line[AGENT_LINE];
    va_list arguments;
    int length;
    va_start(arguments, format);
    length = vsnprintf(line, sizeof(line) - 1, format, arguments);
    va_end(arguments);
    if (length < 0 || (size_t)length >= sizeof(line) - 1) return -1;
    line[length++] = '\n';
    return write_all(fd, line, (size_t)length);
}

static int send_text_line(int fd, const char *prefix, const char *text)
{
    char line[AGENT_LINE];
    size_t size = strlen(prefix);
    if (size >= sizeof(line) || line_append(line, sizeof(line) - 1, &size, text)) return -1;
    line[size++] = '\n';
    return write_all(fd, line, size);
}

static int kernel_catalog(int device, struct kernel_descriptor *items,
                          size_t *count)
{
    struct cautest_kernel_info info;
    uint32_t cursor = 0;
    uint32_t previous_registry = 0;
    uint32_t previous_kernel_suite = 0;
    uint32_t protocol_suite = 0;
    int have_suite = 0;
    *count = 0;
    memset(&info, 0, sizeof(info));
    abi_header(&info.header, sizeof(info));
    if (ioctl(device, CAUTEST_KERNEL_IOCTL_INFO, &info) ||
        info.magic != CAUTEST_KERNEL_ABI_MAGIC ||
        info.header.abi_major != CAUTEST_KERNEL_ABI_MAJOR)
        return -1;
    if (info.descriptor_count == 0)
        return 0;
    do {
        struct cautest_kernel_list item;
        struct kernel_descriptor *target;
        memset(&item, 0, sizeof(item));
        abi_header(&item.header, sizeof(item));
        item.cursor = cursor;
        if (ioctl(device, CAUTEST_KERNEL_IOCTL_LIST, &item)) return -1;
        if (*count >= AGENT_MAX_DESCRIPTORS) return -1;
        if (!have_suite || item.registry_id != previous_registry ||
            item.suite_id != previous_kernel_suite) {
            if (have_suite) protocol_suite++;
            previous_registry = item.registry_id;
            previous_kernel_suite = item.suite_id;
            have_suite = 1;
        }
        target = &items[(*count)++];
        memset(target, 0, sizeof(*target));
        target->suite_id = protocol_suite;
        target->case_id = item.case_id;
        target->param_id = item.param_id;
        target->registry_id = item.registry_id;
        target->descriptor_id = item.descriptor_id;
        target->kernel_suite_id = item.suite_id;
        strcpy(target->suite, item.suite);
        strcpy(target->case_name, item.case_name);
        strcpy(target->parameter, item.parameter);
        cursor = item.next_cursor;
    } while (cursor != CAUTEST_KERNEL_CURSOR_END);
    return 0;
}

static struct kernel_descriptor *find_ids(struct kernel_descriptor *items,
                                          size_t count, uint32_t suite,
                                          uint32_t test_case, uint32_t param)
{
    size_t index;
    for (index = 0; index < count; ++index)
        if (items[index].suite_id == suite && items[index].case_id == test_case &&
            items[index].param_id == param) return &items[index];
    return NULL;
}

static struct kernel_descriptor *find_event(struct kernel_descriptor *items,
                                            size_t count, uint32_t suite,
                                            const struct cautest_kernel_event_record *event)
{
    size_t index;
    for (index = 0; index < count; ++index)
        if (items[index].suite_id == suite && !strcmp(items[index].suite, event->suite) &&
            !strcmp(items[index].case_name, event->case_name) &&
            !strcmp(items[index].parameter, event->parameter)) return &items[index];
    return NULL;
}

static const char *status_name(uint32_t status)
{
    static const char *const names[] = { "PASS", "SKIP", "FAIL", "ERROR" };
    return status < 4 ? names[status] : "ERROR";
}

static const char *level_name(uint32_t level)
{
    static const char *const names[] = { "TRACE", "DEBUG", "INFO", "WARN", "ERROR" };
    return level < 5 ? names[level] : "NONE";
}

static const char *kernel_value_kind(uint32_t kind)
{
    static const char *const names[] = { "none", "u64", "pointer", "string", "bytes" };
    return kind < sizeof(names) / sizeof(names[0]) ? names[kind] : "none";
}

static int append_kernel_value(char *line, size_t capacity, size_t *size,
                               const struct cautest_kernel_event_record *event,
                               int expected)
{
    uint32_t null_flag = expected ? CAUTEST_VALUE_EXPECTED_NULL : CAUTEST_VALUE_ACTUAL_NULL;
    const unsigned char *data = expected ? event->expected_value : event->actual_value;
    uint32_t value_size = expected ? event->expected_size : event->actual_size;
    uint64_t number = expected ? event->expected_unsigned : event->actual_unsigned;
    int length;
    if (event->value_flags & null_flag)
        return line_append(line, capacity, size, "null");
    if (event->value_kind == CAUTEST_VALUE_U64 || event->value_kind == CAUTEST_VALUE_POINTER) {
        length = snprintf(line + *size, capacity - *size, "%llu", (unsigned long long)number);
        if (length < 0 || (size_t)length >= capacity - *size) return -1;
        *size += (size_t)length;
        return 0;
    }
    if (event->value_kind == CAUTEST_VALUE_STRING)
        return line_append_escaped(line, capacity, size, (const char *)data);
    if (event->value_kind == CAUTEST_VALUE_BYTES) {
        static const char hex[] = "0123456789ABCDEF";
        uint32_t index, limit = value_size > 32U ? 32U : value_size;
        for (index = 0; index < limit; ++index) {
            if (*size + 2 >= capacity) return -1;
            line[(*size)++] = hex[data[index] >> 4];
            line[(*size)++] = hex[data[index] & 0x0fU];
        }
        if (value_size > limit) return line_append(line, capacity, size, "...");
    }
    return 0;
}

static int emit_kernel_assert(int fd, uint32_t execution_id,
                              const struct kernel_descriptor *descriptor,
                              uint32_t assertion_id,
                              const struct cautest_kernel_event_record *event)
{
    char prefix[256];
    char line[AGENT_LINE];
    size_t size;
    int length = snprintf(prefix, sizeof(prefix), event->value_kind == CAUTEST_VALUE_NONE ?
        "+ASSERT:%u,%u,%u,%u,%u,%s," : "+ASSERT2:%u,%u,%u,%u,%u,%s,",
        execution_id, descriptor->suite_id, descriptor->case_id,
        descriptor->param_id, assertion_id, status_name(event->status));
    if (length < 0 || (size_t)length >= sizeof(prefix)) return -1;
    strcpy(line, prefix); size = (size_t)length;
    if (line_append_escaped(line, sizeof(line) - 1, &size, event->file)) return -1;
    length = snprintf(line + size, sizeof(line) - size, ",%llu,", (unsigned long long)event->line);
    if (length < 0 || (size_t)length >= sizeof(line) - size) return -1;
    size += (size_t)length;
    if (line_append_escaped(line, sizeof(line) - 1, &size, event->expression)) return -1;
    if (event->value_kind == CAUTEST_VALUE_NONE) {
        length = snprintf(line + size, sizeof(line) - size, ",%lld,%lld\n",
            (long long)event->expected, (long long)event->actual);
        if (length < 0 || (size_t)length >= sizeof(line) - size) return -1;
        size += (size_t)length;
    } else {
        length = snprintf(line + size, sizeof(line) - size, ",%s,%u,",
            kernel_value_kind(event->value_kind), event->value_flags);
        if (length < 0 || (size_t)length >= sizeof(line) - size) return -1;
        size += (size_t)length;
        if (append_kernel_value(line, sizeof(line) - 1, &size, event, 1)) return -1;
        if (size + 1 >= sizeof(line)) return -1;
        line[size++] = ',';
        if (append_kernel_value(line, sizeof(line) - 1, &size, event, 0)) return -1;
        if (size + 1 >= sizeof(line)) return -1;
        line[size++] = '\n';
    }
    return write_all(fd, line, size);
}

static int kernel_execute(int fd, int device,
                          struct kernel_descriptor *items, size_t count,
                          uint32_t execution_id, uint32_t suite_id,
                          struct kernel_descriptor *one, uint32_t stop_policy,
                          const char *command)
{
    struct cautest_kernel_run run;
    uint32_t counts[4] = { 0, 0, 0, 0 };
    uint32_t summary = 0;
    uint32_t assertion_id = 0;
    int terminal = 0;
    memset(&run, 0, sizeof(run));
    abi_header(&run.header, sizeof(run));
    run.registry_id = one->registry_id;
    run.stop_policy = stop_policy;
    if (!strcmp(command, "CASE")) {
        run.selection_flags = CAUTEST_KERNEL_RUN_SELECT_ONE;
        run.descriptor_id = one->descriptor_id;
        if (send_line(fd, "+EXEC-START:%u,CASE,%u,%u,%u", execution_id,
                      suite_id, one->case_id, one->param_id)) return -1;
    } else {
        run.selection_flags = CAUTEST_KERNEL_RUN_SELECT_SUITE;
        run.suite_id = one->kernel_suite_id;
        if (send_line(fd, "+EXEC-START:%u,SUITE,%u,0,0", execution_id,
                      suite_id)) return -1;
    }
    if (send_line(fd, "+SUITE-START:%u,%u", execution_id, suite_id)) return -1;
    if (ioctl(device, CAUTEST_KERNEL_IOCTL_RUN, &run))
        return send_line(fd, "ERROR:%s,%u,INTERNAL,kernel RUN ioctl failed", command, execution_id);
    while (!terminal) {
        struct cautest_kernel_event_record event;
        struct kernel_descriptor *descriptor;
        ssize_t bytes = read(device, &event, sizeof(event));
        if (bytes != (ssize_t)sizeof(event)) return -1;
        if (event.run_id != run.run_id) continue;
        descriptor = find_event(items, count, suite_id, &event);
        switch (event.type) {
        case CAUTEST_KERNEL_EVENT_CASE_START:
            if (!descriptor) return -1;
            assertion_id = 0;
            if (send_line(fd, "+CASE-START:%u,%u,%u,%u", execution_id,
                          suite_id, descriptor->case_id, descriptor->param_id)) return -1;
            break;
        case CAUTEST_KERNEL_EVENT_ASSERTION:
            if (descriptor) {
                if (emit_kernel_assert(fd, execution_id, descriptor,
                                       assertion_id++, &event)) return -1;
            } else {
                char prefix[128];
                snprintf(prefix, sizeof(prefix),
                         "+FAULT:%u,SUITE,%u,0,0,FIXTURE,",
                         execution_id, suite_id);
                if (send_text_line(fd, prefix, event.expression)) return -1;
            }
            break;
        case CAUTEST_KERNEL_EVENT_SKIP:
            if (descriptor) {
                char prefix[128];
                snprintf(prefix, sizeof(prefix), "+SKIP:%u,%u,%u,%u,",
                         execution_id, suite_id, descriptor->case_id,
                         descriptor->param_id);
                if (send_text_line(fd, prefix, event.expression)) return -1;
            } else {
                char prefix[128];
                snprintf(prefix, sizeof(prefix),
                         "+FAULT:%u,SUITE,%u,0,0,FIXTURE,",
                         execution_id, suite_id);
                if (send_text_line(fd, prefix, event.expression)) return -1;
            }
            break;
        case CAUTEST_KERNEL_EVENT_LOG:
            {
                char prefix[160];
                const char *scope = descriptor ? "CASE" : "SUITE";
                snprintf(prefix, sizeof(prefix), "+LOG:%u,%s,%u,%u,%u,TARGET,%s,",
                         execution_id, scope, suite_id,
                         descriptor ? descriptor->case_id : 0,
                         descriptor ? descriptor->param_id : 0,
                         level_name(event.reserved0));
                if (send_text_line(fd, prefix, event.expression)) return -1;
            }
            break;
        case CAUTEST_KERNEL_EVENT_CASE_END:
            if (!descriptor) return -1;
            if (event.status < 4) counts[event.status]++;
            if (event.status > summary) summary = event.status;
            if (send_line(fd, "+CASE-END:%u,%u,%u,%u,%s", execution_id,
                          suite_id, descriptor->case_id, descriptor->param_id,
                          status_name(event.status))) return -1;
            break;
        case CAUTEST_KERNEL_EVENT_ERROR:
            summary = 3;
            if (send_line(fd, "+FAULT:%u,%s,%u,%u,%u,RUNTIME,kernel runtime error",
                          execution_id, descriptor ? "CASE" : "SUITE", suite_id,
                          descriptor ? descriptor->case_id : 0,
                          descriptor ? descriptor->param_id : 0)) return -1;
            break;
        default:
            break;
        }
        if (event.flags & CAUTEST_KERNEL_EVENT_F_FINAL) {
            terminal = 1;
            if (event.status > summary) summary = event.status;
        }
    }
    if (send_line(fd, "+SUITE-END:%u,%u,%s", execution_id, suite_id,
                  status_name(summary)) ||
        send_line(fd, "+EXEC-END:%u,%s,%u,%u,%u,%u", execution_id,
                  status_name(summary), counts[0], counts[2], counts[1], counts[3]) ||
        send_line(fd, "OK:%s,%u", command, execution_id)) return -1;
    return 0;
}

static int kernel_session(int fd, struct catalog_entry *entry)
{
    struct kernel_descriptor items[AGENT_MAX_DESCRIPTORS];
    size_t count = 0;
    uint32_t last_execution = 0;
    int handshaken = 0;
    int device = open(entry->path, O_RDWR | O_CLOEXEC);
    if (device < 0) return -1;
    if (kernel_catalog(device, items, &count)) { close(device); return -1; }
    for (;;) {
        char line[CTP3_RX_LINE_MAX];
        uint32_t execution, suite, test_case, param;
        char policy[32], trailing;
        int read_status = read_command(fd, line, sizeof(line));
        if (read_status == -2) {
            if (send_line(fd, "ERROR:AT,LINE_TOO_LONG,input line exceeds rx limit")) break;
            continue;
        }
        if (read_status) { close(device); return 0; }
        if (!strcmp(line, "AT")) {
            if (send_line(fd, "OK:AT")) break;
        } else if (!strcmp(line, "AT+HELLO")) {
            handshaken = 1;
            if (send_line(fd, "+HELLO:%u,%u,%s,uml-%ld,%u,%u",
                          CTP3_PROTOCOL_MAJOR, CTP3_PROTOCOL_MINOR,
                          entry->build_id, (long)getpid(),
                          CTP3_RX_LINE_MAX, CTP3_TX_LINE_MAX) ||
                send_line(fd, "OK:HELLO")) break;
        } else if (!strcmp(line, "AT+LIST")) {
            size_t index;
            if (!handshaken) { if (send_line(fd, "ERROR:LIST,BAD_STATE,HELLO required")) break; continue; }
            if (send_line(fd, "+LIST:START")) break;
            for (index = 0; index < count; ++index) {
                char prefix[128], output[AGENT_LINE]; size_t size;
                int length = snprintf(prefix, sizeof(prefix), "+CASE:%u,%u,%u,",
                    items[index].suite_id, items[index].case_id, items[index].param_id);
                strcpy(output, prefix); size = (size_t)length;
                if (line_append(output, sizeof(output) - 1, &size, items[index].suite) ||
                    (output[size++] = ',', 0) ||
                    line_append(output, sizeof(output) - 1, &size, items[index].case_name) ||
                    (output[size++] = ',', 0) ||
                    line_append(output, sizeof(output) - 1, &size, items[index].parameter)) { close(device); return -1; }
                output[size++] = '\n';
                if (write_all(fd, output, size)) { close(device); return -1; }
            }
            if (send_line(fd, "+LIST:END,%zu", count) || send_line(fd, "OK:LIST")) break;
        } else if (sscanf(line, "AT+CASE=%u,%u,%u,%u%c", &execution, &suite,
                          &test_case, &param, &trailing) == 4) {
            struct kernel_descriptor *one = find_ids(items, count, suite, test_case, param);
            if (!handshaken) { if (send_line(fd, "ERROR:CASE,%u,BAD_STATE,HELLO required", execution)) break; continue; }
            if (!execution || execution <= last_execution) { if (send_line(fd, "ERROR:CASE,%u,OUT_OF_ORDER_EXECUTION_ID,execution id must increase", execution)) break; continue; }
            if (!one) { if (send_line(fd, "ERROR:CASE,%u,NOT_FOUND,case id not found", execution)) break; continue; }
            last_execution = execution;
            if (kernel_execute(fd, device, items, count, execution, suite, one, 0, "CASE")) break;
        } else if (sscanf(line, "AT+SUITE=%u,%u,%31[^,]%c", &execution, &suite,
                          policy, &trailing) == 3) {
            struct kernel_descriptor *one = find_ids(items, count, suite, 0, 0);
            uint32_t stop_policy = !strcmp(policy, "STOP_ON_FAIL") ? 1 : !strcmp(policy, "STOP_ON_ERROR") ? 2 : 0;
            if (!handshaken) { if (send_line(fd, "ERROR:SUITE,%u,BAD_STATE,HELLO required", execution)) break; continue; }
            if (!execution || execution <= last_execution) { if (send_line(fd, "ERROR:SUITE,%u,OUT_OF_ORDER_EXECUTION_ID,execution id must increase", execution)) break; continue; }
            if ((!strcmp(policy, "CONTINUE") && stop_policy == 0) || !strcmp(policy, "STOP_ON_FAIL") || !strcmp(policy, "STOP_ON_ERROR")) { /* valid */ }
            else { if (send_line(fd, "ERROR:SUITE,%u,BAD_ARGUMENT,invalid policy", execution)) break; continue; }
            if (!one) { if (send_line(fd, "ERROR:SUITE,%u,NOT_FOUND,suite id not found", execution)) break; continue; }
            last_execution = execution;
            if (kernel_execute(fd, device, items, count, execution, suite, one, stop_policy, "SUITE")) break;
        } else if (!strcmp(line, "AT+BYE")) {
            (void)send_line(fd, "OK:BYE"); close(device); return 0;
        } else if (send_line(fd, "ERROR:AT,UNKNOWN_COMMAND,unknown command")) break;
    }
    close(device);
    return -1;
}

/* Process Endpoint 对 fd3/fd4 做透明字节转发，协议终止于子 Target。 */
static int process_session(int fd, const struct catalog_entry *entry)
{
    int control_pipe[2], event_pipe[2];
    pid_t child;
    int child_status = 0;
    if (pipe(control_pipe) || pipe(event_pipe)) return -1;
    child = fork();
    if (child == 0) {
        int console, control_source, event_source;
        close(control_pipe[1]); close(event_pipe[0]);
        control_source = fcntl(control_pipe[0], F_DUPFD_CLOEXEC, 5);
        event_source = fcntl(event_pipe[1], F_DUPFD_CLOEXEC, 5);
        if (control_source < 0 || event_source < 0) _exit(126);
        close(control_pipe[0]); close(event_pipe[1]);
        if (dup2(control_source, 3) < 0 || dup2(event_source, 4) < 0) _exit(126);
        close(control_source); close(event_source);
        console = open("/dev/console", O_WRONLY);
        if (console >= 0) { dup2(console, STDOUT_FILENO); dup2(console, STDERR_FILENO); if (console > STDERR_FILENO) close(console); }
        execl(entry->path, entry->path, (char *)NULL); _exit(127);
    }
    close(control_pipe[0]); close(event_pipe[1]);
    if (child < 0) { close(control_pipe[1]); close(event_pipe[0]); return -1; }
    for (;;) {
        struct pollfd pollers[2] = { { fd, POLLIN, 0 }, { event_pipe[0], POLLIN, 0 } };
        unsigned char bytes[512];
        int status = poll(pollers, 2, -1);
        if (status < 0) { if (errno == EINTR) continue; break; }
        if (pollers[0].revents & (POLLIN | POLLHUP | POLLERR)) {
            ssize_t count = read(fd, bytes, sizeof(bytes));
            if (count <= 0 || write_all(control_pipe[1], bytes, (size_t)count)) break;
        }
        if (pollers[1].revents & (POLLIN | POLLHUP | POLLERR)) {
            ssize_t count = read(event_pipe[0], bytes, sizeof(bytes));
            if (count <= 0) break;
            if (write_all(fd, bytes, (size_t)count)) break;
        }
    }
    close(control_pipe[1]); close(event_pipe[0]);
    (void)kill(child, SIGTERM);
    if (waitpid(child, &child_status, 0) < 0) return -1;
    return WIFEXITED(child_status) && WEXITSTATUS(child_status) == 0 ? 0 : -1;
}

static int hex_value(int byte)
{
    if (byte >= '0' && byte <= '9') return byte - '0';
    if (byte >= 'a' && byte <= 'f') return byte - 'a' + 10;
    if (byte >= 'A' && byte <= 'F') return byte - 'A' + 10;
    return -1;
}

static int execute_catalog(int fd, struct catalog_entry *entry,
                           unsigned int argc)
{
    char **argv;
    unsigned int index;
    pid_t child;
    int status;
    if (strcmp(entry->type, "process") || argc > 32) return write_all(fd, "EXIT 126\n", 9);
    argv = calloc(argc + 2, sizeof(*argv));
    if (!argv) return -1;
    argv[0] = entry->path;
    for (index = 0; index < argc; ++index) {
        char line[2049]; size_t length, byte;
        if (read_command(fd, line, sizeof(line))) { free(argv); return -1; }
        length = strlen(line);
        if (length % 2) { free(argv); return -1; }
        argv[index + 1] = malloc(length / 2 + 1);
        if (!argv[index + 1]) { free(argv); return -1; }
        for (byte = 0; byte < length / 2; ++byte) {
            int high = hex_value(line[byte * 2]), low = hex_value(line[byte * 2 + 1]);
            if (high < 0 || low < 0) { free(argv[index + 1]); argv[index + 1] = NULL; break; }
            argv[index + 1][byte] = (char)((high << 4) | low);
        }
        if (!argv[index + 1]) { free(argv); return -1; }
        argv[index + 1][length / 2] = '\0';
    }
    child = fork();
    if (child == 0) { int console = open("/dev/console", O_WRONLY); if (console >= 0) { dup2(console, STDOUT_FILENO); dup2(console, STDERR_FILENO); } execv(entry->path, argv); _exit(127); }
    if (child < 0 || waitpid(child, &status, 0) < 0) status = 127 << 8;
    for (index = 0; index < argc; ++index) free(argv[index + 1]);
    free(argv);
    {
        char response[32];
        int code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
        int length = snprintf(response, sizeof(response), "EXIT %d\n", code);
        return write_all(fd, response, (size_t)length);
    }
}

static int export_gcov(int fd)
{
    pid_t child = fork();
    int status;
    int code;
    char response[32];
    int length;
    if (child == 0) {
        execl("/bin/busybox", "busybox", "cp", "-a",
              "/sys/kernel/debug/gcov/.", "/mnt/cautest-coverage/",
              (char *)0);
        _exit(127);
    }
    if (child < 0 || waitpid(child, &status, 0) < 0)
        code = 126;
    else
        code = WIFEXITED(status) ? WEXITSTATUS(status) :
                                  128 + WTERMSIG(status);
    length = snprintf(response, sizeof(response), "GCOV %d\n", code);
    return length < 0 || (size_t)length >= sizeof(response) ? -1 :
           write_all(fd, response, (size_t)length);
}

int main(int argc, char **argv)
{
    const char *device_path = argc > 1 ? argv[1] : "/dev/ttyS0";
    const char *catalog_path = argc > 2 ? argv[2] : "/etc/cautest/catalog";
    struct catalog catalog;
    int fd;
    struct termios tty;
    if (load_catalog(catalog_path, &catalog)) { dprintf(STDERR_FILENO, "cautest-agent: cannot load catalog %s: %s\n", catalog_path, strerror(errno)); return 2; }
    fd = open(device_path, O_RDWR | O_NOCTTY);
    if (fd < 0) { dprintf(STDERR_FILENO, "cautest-agent: cannot open %s: %s\n", device_path, strerror(errno)); return 2; }
    if (!tcgetattr(fd, &tty)) { cfmakeraw(&tty); tcsetattr(fd, TCSANOW, &tty); }
    if (dprintf(fd, "CAUTEST_AGENT_READY 1 %s %ld\n", catalog.build_id, (long)getpid()) < 0) return 2;
    for (;;) {
        char command[256], endpoint[AGENT_MAX_ENDPOINT];
        unsigned int argument_count = 0;
        struct catalog_entry *entry;
        char trailing;
        if (read_command(fd, command, sizeof(command))) break;
        if (sscanf(command, "OPEN %63s %c", endpoint, &trailing) == 1) {
            entry = catalog_find(&catalog, endpoint);
            if (!entry || (strcmp(entry->type, "kernel") && strcmp(entry->type, "process"))) { write_all(fd, "DENY\n", 5); continue; }
            if (write_all(fd, "OK\n", 3)) break;
            if ((!strcmp(entry->type, "kernel") && kernel_session(fd, entry)) ||
                (!strcmp(entry->type, "process") && process_session(fd, entry))) break;
        } else if (sscanf(command, "EXEC %63s %u %c", endpoint, &argument_count, &trailing) == 2) {
            entry = catalog_find(&catalog, endpoint);
            if (!entry || execute_catalog(fd, entry, argument_count)) write_all(fd, "EXIT 126\n", 9);
        } else if (!strcmp(command, "GCOV")) {
            if (export_gcov(fd)) break;
        } else if (!strcmp(command, "SHUTDOWN")) {
            sync(); reboot(RB_POWER_OFF); break;
        } else if (!strcmp(command, "GOODBYE")) {
            write_all(fd, "BYE\n", 4);
        } else write_all(fd, "DENY\n", 5);
    }
    close(fd);
    return 0;
}
