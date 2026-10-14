const express = require('express');
const router = express.Router();

const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/notifications
 * Fetch notifications for the authenticated user.
 * Requires valid JWT token — returns notifications relevant to this user's role and ID.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = (req.user.role || 'ALL').toUpperCase();

    // Admins see all notifications; responders and victims see their own + role-wide
    let query;
    if (userRole === 'ADMIN') {
      query = {
        $or: [
          { target_role: 'ADMIN' },
          { target_role: 'ALL' }
        ]
      };
    } else {
      query = {
        $or: [
          { user_id: userId },
          { target_role: userRole },
          { target_role: 'ALL' }
        ]
      };
    }

    const notifications = await Notification.find(query)
      .sort({ created_at: -1 })
      .limit(50);

    return res.status(200).json({
      success: true,
      count: notifications.length,
      notifications
    });
  } catch (err) {
    console.error('Error retrieving notifications:', err);
    return res.status(500).json({ success: false, message: 'Error retrieving notifications' });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read. Requires auth.
 */
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { read: true },
      { returnDocument: 'after' }
    );
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    return res.status(200).json({ success: true, notification });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error updating notification' });
  }
});

/**
 * PATCH /api/notifications/read-all
 * Mark all notifications as read for the authenticated user. Requires auth.
 */
router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = (req.user.role || 'ALL').toUpperCase();

    let query;
    if (userRole === 'ADMIN') {
      query = { $or: [{ target_role: 'ADMIN' }, { target_role: 'ALL' }] };
    } else {
      query = {
        $or: [
          { user_id: userId },
          { target_role: userRole },
          { target_role: 'ALL' }
        ]
      };
    }

    await Notification.updateMany({ ...query, read: false }, { read: true });
    return res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error marking notifications as read' });
  }
});

module.exports = router;
