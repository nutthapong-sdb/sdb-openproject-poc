document.addEventListener('DOMContentLoaded', async () => {
    // Global variable for current user ID (for history separation)
    let currentUserId = null;

    // Fetch User Info
    try {
        const userRes = await fetch('/api/user');
        if (userRes.ok) {
            const userData = await userRes.json();
            currentUserId = userData.id; // Store user ID
            const displayName = userData.firstName ? `${userData.firstName} ${userData.lastName}` : (userData.name || 'User');
            document.getElementById('userNameDisplay').textContent = displayName;
        }
    } catch (e) {
        console.error('Failed to load user info', e);
    }

    // Set Default Dates to Today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('startDate').value = today;
    document.getElementById('dueDate').value = today;

    // Initialize Select2 with AJAX (Projects)
    const projectSelect = $('#projectId').select2({
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

    // Load Last Used Project from LocalStorage
    const lastProject = JSON.parse(localStorage.getItem('lastProject') || 'null');
    if (lastProject && lastProject.id) {
        const option = new Option(lastProject.name, lastProject.id, true, true);
        projectSelect.append(option).trigger('change');
    }

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

            if (currentVal) {
                assigneeSelect.val(currentVal).trigger('change');
            } else {
                // Auto-select Current User
                try {
                    const meRes = await fetch('/api/user');
                    if (meRes.ok) {
                        const me = await meRes.json();
                        const myName = me.name || (me.firstName + ' ' + me.lastName);
                        const match = users.find(u => u.name === myName);
                        if (match) {
                            assigneeSelect.val(match.id).trigger('change');
                        }
                    }
                } catch (e) { console.warn('Auto-select user failed', e); }
            }

        } catch (error) {
            console.error('Error loading local assignees:', error);
        }
    };

    // --- History Logic (SQLite via API) ---
    const loadHistory = async () => {
        const historyBody = document.getElementById('historyBody');

        try {
            const response = await fetch('/api/history');
            if (!response.ok) {
                historyBody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #777;">Failed to load history.</td></tr>';
                return;
            }

            const history = await response.json();

            if (history.length === 0) {
                historyBody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #777;">No recent tasks created.</td></tr>';
                return;
            }

            historyBody.innerHTML = '';
            history.forEach(item => {
                const createdAt = item.created_at ? new Date(item.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-';
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="padding: 12px 10px; border-bottom: 1px solid #333; color: #aaa; font-size: 0.85rem;">${createdAt}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #333; font-weight: 500;">${item.subject || '-'}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #333; color: #aaa;">${item.project_name || '-'}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #333;">${item.start_date || '-'}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #333;">${item.due_date || '-'}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #333; text-align: center;">${item.spent_hours ? item.spent_hours + ' h' : '-'}</td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #333; text-align: center;"><a href="${item.web_url}" target="_blank" class="history-link" style="color: #FF8F00;">View</a></td>
                    <td style="padding: 12px 10px; border-bottom: 1px solid #333; text-align: center;">
                        <button class="delete-history-btn" data-id="${item.id}" data-op-id="${item.openproject_id}" data-subject="${item.subject}" style="background: #c62828; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">✕</button>
                    </td>
                `;
                historyBody.appendChild(row);
            });

            // Attach delete handlers
            document.querySelectorAll('.delete-history-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const btnElement = e.currentTarget;
                    const historyId = btnElement.dataset.id;
                    const opId = btnElement.dataset.opId;
                    const subject = btnElement.dataset.subject;
                    deleteFromHistory(historyId, opId, subject);
                });
            });
        } catch (error) {
            console.error('Error loading history:', error);
            historyBody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #c62828;">Error loading history.</td></tr>';
        }
    };

    const deleteFromHistory = async (historyId, openprojectId, subject) => {
        // Confirmation Dialog
        const result = await Swal.fire({
            title: 'Delete Task?',
            html: `<p>Are you sure you want to delete:</p><p><strong>${subject}</strong></p><p style="color: #c62828;">This will also delete it from OpenProject!</p>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#c62828',
            cancelButtonColor: '#555',
            confirmButtonText: 'Yes, Delete',
            cancelButtonText: 'Cancel'
        });

        if (!result.isConfirmed) return;

        // Show loading
        Swal.fire({
            title: 'Deleting...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            // Delete from OpenProject
            const opResponse = await fetch(`/api/work_packages/${openprojectId}`, {
                method: 'DELETE'
            });

            // Delete from local history DB (regardless of OpenProject result)
            await fetch(`/api/history/${historyId}`, {
                method: 'DELETE'
            });

            loadHistory();

            if (opResponse.ok || opResponse.status === 404) {
                Swal.fire({
                    icon: 'success',
                    title: 'Deleted!',
                    text: 'Task deleted successfully.',
                    timer: 2000,
                    showConfirmButton: false
                });
            } else {
                Swal.fire({
                    icon: 'warning',
                    title: 'Partially Deleted',
                    text: 'Removed from history, but could not delete from OpenProject (it might have been deleted already).'
                });
            }
        } catch (error) {
            console.error('Delete error:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Network error. Please try again.'
            });
        }
    };

    const addToHistory = async (task) => {
        try {
            await fetch('/api/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    openprojectId: task.id,
                    subject: task.subject,
                    projectName: task.projectName,
                    startDate: task.startDate,
                    dueDate: task.dueDate,
                    spentHours: task.spentHours,
                    webUrl: task.webUrl
                })
            });
            loadHistory();
        } catch (error) {
            console.error('Error adding to history:', error);
        }
    };



    // Load on start
    loadAssignees();
    loadHistory();

    // Settings Dropdown Logic
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsDropdown = document.getElementById('settingsDropdown');

    if (settingsBtn && settingsDropdown) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsDropdown.style.display = settingsDropdown.style.display === 'block' ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!settingsBtn.contains(e.target) && !settingsDropdown.contains(e.target)) {
                settingsDropdown.style.display = 'none';
            }
        });
    }

    // Sync Users Logic
    const syncUsersBtn = document.getElementById('syncUsersBtn');
    if (syncUsersBtn) {
        syncUsersBtn.addEventListener('click', async (e) => {
            console.log('Sync Users Clicked'); // Debug
            // Don't close immediately if needed, but usually clicking button implies action done
            // e.stopPropagation(); 

            const originalText = syncUsersBtn.innerText;
            syncUsersBtn.innerText = 'Syncing...';
            syncUsersBtn.disabled = true;
            syncUsersBtn.style.cursor = 'wait';

            try {
                const response = await fetch('/api/sync-users', { method: 'POST' });
                const result = await response.json();

                if (response.ok) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Sync Complete',
                        text: result.message || 'User list synchronized successfully.',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    loadAssignees(); // Reload dropdown
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('Sync failed:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Sync Failed',
                    text: error.message || 'Could not sync users.'
                });
            } finally {
                syncUsersBtn.innerText = originalText;
                syncUsersBtn.disabled = false;
                syncUsersBtn.style.cursor = 'pointer';
            }
        });
    }

    // Sync Projects Logic
    const syncProjectsBtn = document.getElementById('syncProjectsBtn');
    if (syncProjectsBtn) {
        syncProjectsBtn.addEventListener('click', async (e) => {
            console.log('Sync Projects Clicked'); // Debug
            const originalText = syncProjectsBtn.innerText;
            syncProjectsBtn.innerText = 'Syncing...';
            syncProjectsBtn.disabled = true;
            syncProjectsBtn.style.cursor = 'wait';

            try {
                const response = await fetch('/api/sync-projects', { method: 'POST' });
                const result = await response.json();

                if (response.ok) {
                    await Swal.fire({
                        icon: 'success',
                        title: 'Sync Complete',
                        text: `Synchronized ${result.count} projects successfully.`,
                        showConfirmButton: true,
                        confirmButtonText: 'Great, thanks!'
                    });

                    // Reload after user closes the popup
                    location.reload();
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('Sync failed:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Sync Failed',
                    text: error.message || 'Could not sync projects.'
                });
            } finally {
                syncProjectsBtn.innerText = originalText;
                syncProjectsBtn.disabled = false;
                syncProjectsBtn.style.cursor = 'pointer';
            }
        });
    }

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

            if (!createRes.ok) {
                console.error('Auto-assign failed status:', createRes.status);
                return null;
            }

            const resText = await createRes.text();
            if (!resText) {
                console.error('Auto-assign server returned empty response');
                return null;
            }

            let newAssignee;
            try {
                newAssignee = JSON.parse(resText);
            } catch (jsonErr) {
                console.error('Failed to parse auto-assign response:', resText);
                return null;
            }

            console.log('Auto-Assigned User:', newAssignee);

            // Add to dropdown
            const newOption = new Option(newAssignee.name, newAssignee.id, true, true);
            $('#assigneeId').append(newOption).trigger('change');

            // Notify User
            Swal.fire({
                icon: 'info',
                title: 'Auto-Assigned',
                text: `You have been assigned as: ${newAssignee.name}`,
                timer: 2000,
                showConfirmButton: false,
                toast: true,
                position: 'top-end'
            });

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

        if (!projectId || !subject) {
            Swal.fire({
                icon: 'warning',
                title: 'Missing Info',
                text: 'Please select a project and enter a task name.',
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

            // Safe JSON Parsing
            const resText = await response.text();
            let result;
            try {
                result = resText ? JSON.parse(resText) : {};
            } catch (parseErr) {
                console.error('Failed to parse response:', resText);
                throw new Error('Server returned invalid response. Check logs.');
            }

            if (response.ok) {
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
                    }).then(() => {
                        location.reload();
                    });
                    return;
                }

                // Show Success Modal and Reload
                Swal.fire({
                    icon: 'success',
                    title: title,
                    html: `Task <b>#${result.id}</b> created.<br><a href="${result.webUrl}" target="_blank" style="color: var(--primary-color);">Click to view in OpenProject</a>`,
                    confirmButtonText: 'OK, New Task',
                    allowOutsideClick: false
                }).then(() => {
                    // Refresh the page to reset form
                    location.reload();
                });

                // Update History
                await addToHistory({
                    subject: subject,
                    projectName: $('#projectId').find(':selected').text() || 'Unknown Project',
                    webUrl: result.webUrl,
                    startDate: startDate,
                    dueDate: dueDate,
                    spentHours: spentHours,
                    id: result.id
                });

                // Save Last Used Project
                localStorage.setItem('lastProject', JSON.stringify({
                    id: projectId,
                    name: $('#projectId').find(':selected').text() || 'Unknown Project'
                }));

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
