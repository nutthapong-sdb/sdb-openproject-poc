document.addEventListener('DOMContentLoaded', async () => {
    // Fetch User Info
    try {
        const userRes = await fetch('/api/user');
        if (userRes.ok) {
            const userData = await userRes.json();
            const displayName = userData.firstName ? `${userData.firstName} ${userData.lastName}` : (userData.name || 'User');
            // Try to use full name if available, else name
            document.getElementById('userNameDisplay').textContent = displayName;
        }
    } catch (e) {
        console.error('Failed to load user info', e);
    }

    // Initialize Select2 with AJAX (Projects)
    $('#projectId').select2({
        width: '100%',
        placeholder: 'Search for a project...',
        minimumInputLength: 0,
        ajax: {
            url: '/api/projects',
            dataType: 'json',
            delay: 250,
            data: function (params) {
                return {
                    q: params.term
                };
            },
            processResults: function (data) {
                // Ensure array
                let projects = [];
                if (Array.isArray(data)) {
                    projects = data;
                } else if (data._embedded && data._embedded.elements) {
                    projects = data._embedded.elements;
                }

                return {
                    results: projects.map(project => ({
                        id: project.id,
                        text: project.name
                    }))
                };
            },
            cache: true
        }
    });

    // Initialize Select2 for Assignee (Standard Select, populated dynamically)
    const assigneeSelect = $('#assigneeId').select2({
        width: '100%',
        placeholder: 'Select an Assignee'
    });

    // Function to Load Local Assignees
    const loadAssignees = async () => {
        try {
            const response = await fetch('/api/assignees');
            const users = await response.json();

            // Keep current selection if possible
            const currentVal = assigneeSelect.val();

            assigneeSelect.empty().append('<option value="" disabled selected>Select an Assignee</option>');

            users.forEach(user => {
                const option = new Option(user.name, user.id, false, false);
                assigneeSelect.append(option);
            });

            if (currentVal) assigneeSelect.val(currentVal).trigger('change');

        } catch (error) {
            console.error('Error loading local assignees:', error);
        }
    };

    // --- History Logic (LocalStorage) ---
    const loadHistory = () => {
        const historyBody = document.getElementById('historyBody');
        const history = JSON.parse(localStorage.getItem('task_history') || '[]');

        if (history.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #777;">No recent tasks created.</td></tr>';
            return;
        }

        historyBody.innerHTML = '';
        // Show newest first
        [...history].reverse().forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="padding: 12px 10px; border-bottom: 1px solid #333; color: #aaa; font-size: 0.85rem;">${item.timestamp}</td>
                <td style="padding: 12px 10px; border-bottom: 1px solid #333; font-weight: 500;">${item.subject}</td>
                <td style="padding: 12px 10px; border-bottom: 1px solid #333; color: #aaa;">${item.projectName}</td>
                <td style="padding: 12px 10px; border-bottom: 1px solid #333;">${item.startDate || '-'}</td>
                <td style="padding: 12px 10px; border-bottom: 1px solid #333;">${item.dueDate || '-'}</td>
                <td style="padding: 12px 10px; border-bottom: 1px solid #333; text-align: center;">${item.spentHours ? item.spentHours + ' h' : '-'}</td>
                <td style="padding: 12px 10px; border-bottom: 1px solid #333; text-align: center;"><a href="${item.webUrl}" target="_blank" class="history-link" style="color: #FF8F00;">View</a></td>
            `;
            historyBody.appendChild(row);
        });
    };

    const addToHistory = (task) => {
        const history = JSON.parse(localStorage.getItem('task_history') || '[]');
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        history.push({
            timestamp: timeString,
            subject: task.subject,
            projectName: task.projectName,
            startDate: task.startDate,
            dueDate: task.dueDate,
            spentHours: task.spentHours,
            webUrl: task.webUrl,
            id: task.id
        });

        // Keep last 50
        if (history.length > 50) history.shift();

        localStorage.setItem('task_history', JSON.stringify(history));
        loadHistory();
    };

    // Refresh Button
    const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
    if (refreshHistoryBtn) refreshHistoryBtn.addEventListener('click', loadHistory);

    // Load on start
    loadAssignees();
    loadHistory();

    // Logout Logic
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/logout', { method: 'POST' });
                window.location.href = '/login.html';
            } catch (e) {
                console.error('Logout failed', e);
                window.location.href = '/login.html';
            }
        });
    }

    // Manage Assignees Button Logic
    document.getElementById('manageAssigneesBtn').addEventListener('click', async () => {
        // Fetch current list for modal
        const response = await fetch('/api/assignees');
        const users = await response.json();

        let html = '<div style="text-align: left; max-height: 300px; overflow-y: auto;">';
        if (users.length === 0) html += '<p style="text-align:center;">No assignees found.</p>';
        else {
            html += '<ul style="list-style: none; padding: 0;">';
            users.forEach(u => {
                html += `<li style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #444;">
                    <span style="font-size: 0.95rem;">${u.name} <br><small style="color:#aaa;">(ID: ${u.openproject_id || 'N/A'})</small></span>
                    <div>
                        <button class="edit-btn" data-id="${u.id}" data-name="${u.name}" data-opid="${u.openproject_id || ''}" style="margin-right: 5px; padding: 4px 10px; font-size: 0.8rem; background-color: #2C2C2C; color: white; border: 1px solid #555; border-radius: 4px; cursor: pointer;">Edit</button>
                        <button class="delete-btn" data-id="${u.id}" style="padding: 4px 10px; font-size: 0.8rem; background-color: #CF6679; color: white; border: none; border-radius: 4px; cursor: pointer;">Del</button>
                    </div>
                </li>`;
            });
            html += '</ul>';
        }
        html += '</div><button id="addNewAssigneeBtn" class="swal2-confirm swal2-styled" style="margin-top: 15px; width: 100%;">+ Add New Assignee</button>';

        await Swal.fire({
            title: 'Manage Assignees',
            html: html,
            showConfirmButton: false,
            showCloseButton: true,
            width: 500,
            didOpen: () => {
                // Add New
                document.getElementById('addNewAssigneeBtn').addEventListener('click', () => {
                    Swal.close();
                    openAddEditModal();
                });

                // Edit
                document.querySelectorAll('.edit-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        Swal.close();
                        openAddEditModal(btn.dataset.id, btn.dataset.name, btn.dataset.opid);
                    });
                });

                // Delete
                document.querySelectorAll('.delete-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.dataset.id;
                        if (confirm('Delete this assignee?')) {
                            await fetch(`/api/assignees/${id}`, { method: 'DELETE' });
                            Swal.close();
                            document.getElementById('manageAssigneesBtn').click(); // Re-open
                            loadAssignees(); // Reload dropdown
                        }
                    });
                });
            }
        });
    });

    const openAddEditModal = async (id = null, name = '', opId = '') => {
        const isEdit = !!id;

        await Swal.fire({
            title: isEdit ? 'Edit Assignee' : 'Add Assignee',
            html:
                `<div style="display:flex; flex-direction: column; gap: 10px;">` +
                `<input id="swal-input1" class="swal2-input" placeholder="Name (e.g. John Doe)" value="${name}" style="margin: 0;">` +
                `</div>`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Save',
            confirmButtonColor: '#FF8F00',
            showLoaderOnConfirm: true,
            preConfirm: async () => {
                const newName = document.getElementById('swal-input1').value;
                if (!newName) {
                    Swal.showValidationMessage('Name is required');
                    return false;
                }

                const method = isEdit ? 'PUT' : 'POST';
                const url = isEdit ? `/api/assignees/${id}` : '/api/assignees';
                const currentProjectId = $('#projectId').val();

                try {
                    const response = await fetch(url, {
                        method: method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: newName,
                            projectId: currentProjectId // Optional now
                        })
                    });

                    const res = await response.json();

                    if (!response.ok) {
                        throw new Error(res.error || 'Failed to save');
                    }

                    return res;
                } catch (error) {
                    Swal.showValidationMessage(`Error: ${error.message}`);
                    return false;
                }
            },
            allowOutsideClick: () => !Swal.isLoading()
        }).then((result) => {
            if (result.isConfirmed) {
                // Success
                Swal.fire('Success', 'Saved!', 'success')
                    .then(() => {
                        loadAssignees();
                        document.getElementById('manageAssigneesBtn').click(); // Re-open list
                    });
            } else if (result.dismiss === Swal.DismissReason.cancel) {
                // Cancelled
                document.getElementById('manageAssigneesBtn').click(); // Re-open list
            }
        });
    };

    // Enforce focus on search box when opened
    $(document).on('select2:open', () => {
        const searchField = document.querySelector('.select2-search__field');
        if (searchField) searchField.focus();
    });

    const form = document.getElementById('createTaskForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnLoader = document.getElementById('btnLoader');
    const btnText = submitBtn.querySelector('span');

    // Percentage Buttons
    const percentBtns = document.querySelectorAll('.percent-btn');
    const percentInput = document.getElementById('percentageDone');

    percentBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all
            percentBtns.forEach(b => b.classList.remove('active'));
            // Add to clicked
            btn.classList.add('active');
            // Set value
            percentInput.value = btn.dataset.value;
        });
    });

    // Today Button
    document.getElementById('todayBtn').addEventListener('click', () => {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('startDate').value = today;
    });

    // Same Date Button
    document.getElementById('sameDateBtn').addEventListener('click', () => {
        const startDate = document.getElementById('startDate').value;
        if (startDate) {
            document.getElementById('dueDate').value = startDate;
        } else {
            Swal.fire({
                icon: 'info',
                text: 'Please select a Start Date first.',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });
        }
    });

    // Detect Project Change to fetch Assignees - REMOVED for Local Management
    // $('#projectId').on('select2:select', ...);

    // --- Auto-Assign Self Helper ---
    const getSelfAssigneeId = async () => {
        try {
            // 1. Get Current User Info
            const userRes = await fetch('/api/user');
            if (!userRes.ok) return null;
            const userData = await userRes.json();
            const myOpId = userData.id;
            const myName = userData.name || (userData.firstName + ' ' + userData.lastName);

            if (!myOpId) return null;

            // 2. Check if exists in dropdown
            let existingVal = null;
            $('#assigneeId option').each(function () {
                if ($(this).text().trim() === myName.trim()) {
                    existingVal = $(this).val();
                    return false;
                }
            });

            if (existingVal) return existingVal;

            // 3. Create New via API
            const createRes = await fetch('/api/assignees', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: myName,
                    projectId: $('#projectId').val(),
                    openProjectId: myOpId
                })
            });

            if (!createRes.ok) return null;

            const newAssignee = await createRes.json();

            // Add to dropdown
            const newOption = new Option(newAssignee.name, newAssignee.id, true, true);
            $('#assigneeId').append(newOption).trigger('change');

            return newAssignee.id;

        } catch (e) {
            console.error('Auto-assign self error:', e);
            return null;
        }
    };

    // 2. Handle Form Submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Get values
        const projectId = $('#projectId').val();
        let assigneeId = $('#assigneeId').val();
        const subject = document.getElementById('taskName').value;

        // Auto-Assign Self if empty
        if (!assigneeId) {
            assigneeId = await getSelfAssigneeId();
        }
        let startDate = document.getElementById('startDate').value;
        let dueDate = document.getElementById('dueDate').value;
        const percentageDone = document.getElementById('percentageDone').value;
        let spentHours = document.getElementById('spentHours').value;

        // Default to 1 hour if empty
        if (!spentHours) spentHours = '1';

        // Auto-fill Dates Logic
        const today = new Date().toISOString().split('T')[0];

        if (!startDate) {
            startDate = today;
        }

        if (!dueDate) {
            dueDate = startDate;
        }

        if (!projectId || !subject || !assigneeId) {
            Swal.fire({
                icon: 'warning',
                title: 'Missing Info',
                text: 'Please select Project, Assignee, and enter Task Name.',
                confirmButtonColor: '#FF8F00'
            });
            return;
        }

        // Loading State
        submitBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'block';

        try {
            const response = await fetch('/api/work_packages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    projectId,
                    subject,
                    assigneeId,
                    startDate,
                    dueDate,
                    percentageDone,
                    spentHours // Send to backend
                })
            });

            const result = await response.json();

            if (response.ok) {
                // Toast Notification
                const Toast = Swal.mixin({
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 5000,
                    timerProgressBar: true,
                    didOpen: (toast) => {
                        toast.addEventListener('mouseenter', Swal.stopTimer)
                        toast.addEventListener('mouseleave', Swal.resumeTimer)
                    },
                    customClass: {
                        popup: 'colored-toast'
                    }
                });

                let title = 'Task Created Successfully!';
                if (result.timeLogged) {
                    title = 'Task & Time Logged!';
                } else if (result.timeError) {
                    // Show warning toast for time error
                    Swal.fire({
                        icon: 'warning',
                        title: 'Task Created, but...',
                        text: result.timeError,
                        footer: `<a href="${result.webUrl}" target="_blank">Open Task</a>`
                    });
                    return; // Stop here to let user see modal
                }

                Toast.fire({
                    icon: 'success',
                    title: title,
                    html: `<a href="${result.webUrl}" target="_blank" style="color: #333; text-decoration: underline;">View Work Package #${result.id}</a>`
                });

                // Update History
                addToHistory({
                    subject: subject,
                    projectName: $('#projectId').find(':selected').text() || 'Unknown Project',
                    webUrl: result.webUrl,
                    startDate: startDate,
                    dueDate: dueDate,
                    spentHours: spentHours,
                    id: result.id
                });

                // Reset Form
                document.getElementById('taskName').value = '';
                document.getElementById('startDate').value = '';
                document.getElementById('dueDate').value = '';
                document.getElementById('spentHours').value = '1';
                document.getElementById('percentageDone').value = '100';

                percentBtns.forEach(b => {
                    b.classList.remove('active');
                    if (b.dataset.value === '100') b.classList.add('active');
                });

                $('#projectId').val(null).trigger('change'); // Reset Select2
                $('#assigneeId').val(null).trigger('change').prop('disabled', true); // Reset Assignee

            } else {
                throw new Error(result.errorIdentifier || result.message || 'Unknown error');
            }

        } catch (error) {
            console.error('Error creating task:', error);
            Swal.fire({
                icon: 'error',
                title: 'Failed',
                text: error.message || 'Something went wrong.',
                confirmButtonColor: '#CF6679'
            });
        } finally {
            // Reset Loading State
            submitBtn.disabled = false;
            btnText.style.display = 'block';
            btnLoader.style.display = 'none';
        }
    });
});
