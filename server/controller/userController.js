import User from '../models/User';
import FriendList from '../models/FriendList';
import { body, validationResult } from 'express-validator/check';
import { sanitizeBody } from 'express-validator/filter';
import logger from 'winston';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { uploadFileToS3 } from '../utils/s3buckethandler';

const JWT_SECRET = process.env.JWT_SECRET || 'qsapiensecret';
const PROFILE_IMAGES_DEST = process.env.PROFILE_IMAGES_DEST || './public/profileImages';
logger.level = 'debug';

const REACT_APP_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const storage = multer.diskStorage({
    destination: PROFILE_IMAGES_DEST,
    filename(req, file, cb) {
        cb(null, `${file.originalname}`);
    }
});

const upload = multer({ storage });

exports.user_signup_post = [
    body('first_name', 'first name is required').isLength({ min: 1 }).trim(),
    body('email_id', 'Invalid Email Address').isEmail().trim().normalizeEmail(),
    body('password', 'Password must be at least 6 characters long and must contain numeric digit').isLength({ min: 6 }).matches(/\d/),
    body('username', 'Username is required').isLength({ min: 4 }),
    (req, res, next) => {
        logger.info('user signup post method entry point');
        logger.debug("user signup request body::" + JSON.stringify(req.body));
        let signupData = {};
        for (let prop in req.body) {
            if (req.body[prop] != '' && prop != 'confirm_password')
                signupData[prop] = req.body[prop];
        }
        let user = new User(signupData);

        logger.debug("user signup data:: " + JSON.stringify(signupData));
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            let errorMsgs = [];
            let tempErr = errors.mapped();
            logger.debug("express validator validation error:: " + JSON.stringify(tempErr));
            for (let prop in tempErr)
                errorMsgs.push(tempErr[prop].msg);
            return res.status(400).json({ message: 'error occured' });
        }
        else {
            User.findOne({ email_id: req.body.email_id }, (err, result) => {
                if (err) {
                    logger.debug("finding record in user database error::" + JSON.stringify(err));
                    return next(err);
                }
                else if (result) {
                    logger.info("email id already in use");
                    return res.status(400).json({ message: 'email id already exists' });
                }
                else {
                    user.save((err, result) => {
                        if (err) {
                            logger.info('error occured while saving user record');
                            logger.debug("error::" + err.message);
                            return next(err);
                        }
                        let token = jwt.sign({ id: result._id }, JWT_SECRET, { expiresIn: 86400 });
                        req.session.locallibrarytoken = token;
                        res.status(200).json({ message: 'user completed signup successfully', token: token });
                    });
                }
            });
        }

    }
]


exports.user_login_post = [
    body('email_id', 'Email Id is required').isEmail(),
    body('password', 'Invalid Password').isLength({ min: 6 }).matches(/\d/),
    (req, res, next) => {
        logger.info('login admin post method entry point');
        logger.debug('-------login method body----------' + JSON.stringify(req.body));
        if (req.session.token) {
            jwt.verify(req.session.locallibrarytoken, JWT_SECRET, (err, decoded) => {
                if (err) {
                    logger.debug("error occured while verifying token::" + JSON.stringify(err));
                    return next(err);
                }
                logger.info("jwt token verified successfully");
                return res.status(200).json({ message: 'user verified successfully' });
            })
        }
        let errors = validationResult(req);
        if (!errors.isEmpty()) {
            let errorMsgs = [];
            let tempErr = errors.mapped();
            logger.debug("express validator validation error:: " + JSON.stringify(tempErr));
            for (let prop in tempErr)
                errorMsgs.push(tempErr[prop].msg);
            return res.status(400).json({ message: 'error occured while verifying user' });
        }
        else {
            User.findOne({ email_id: req.body.email_id }, (err, result) => {
                logger.info('inside find user');
                logger.debug('login method find method result::' + JSON.stringify(result));
                if (err) {
                    next(err);
                }
                else if (!result) {
                    logger.info('error occured email id not registered');
                    res.status(400).json({ message: 'email id is not registered' });
                }
                else if (result.password !== req.body.password) {
                    logger.info('error occured password does not match');
                    res.status(400).json({ message: 'Password does not match with given email address' });
                }
                else {
                    logger.info('in login method::user verified successfully:: sending jwt token in request');
                    let token = jwt.sign({ id: result._id }, JWT_SECRET, { expiresIn: 86400 });
                    req.session.locallibrarytoken = token;
                    return res.status(200).json({ token: { userId: result._id, token }, message: 'user verified successfully' });
                }
            })
        }
    }
]


exports.user_file_upload = [upload.single('file'), (req, res) => {

    console.log(JSON.stringify(req.body));
    if (req.body.userId) {
        const updated_profile_image_url = `${REACT_APP_API_URL}/profileImages/${req.file.originalname}`;
        User.findOneAndUpdate({ _id: req.body.userId }, { $set: { profile_image_url: updated_profile_image_url } }, (err, values) => {
            if (err) {
                logger.info('error occured while updating profile image');
                logger.debug('occured error:', err);
                res.status(500).json({ success: false, message: 'internal error occured while updating profile image' });
            }
            else {
                logger.info('profile image updated successfully')
                res.status(200).json({ success: true, message: 'profile image updated successfully' });
            }
        })
    }
    else {
        res.status(400).json({ success: false, message: 'profile image failed to update.specified user id does not exist' });
    }
    // uploadFileToS3(req.body.file,req.body.file.filename,function(err,data){
    //     if(err){
    //         logger.info('error occured while uploading file to s3 bucket');
    //         console.log(JSON.stringify(err));
    //     }
    //     else{
    //         console.log('received data::'+JSON.stringify(data));
    //         logger.info('file uploaded successfully to s3 bucket');
    //     }
    // });

}]

exports.get_user_post = [
    body("userId", 'user id must be provided while fetching user object').exists(),
    (req, res, next) => {
        logger.info('get user object method entry point');
        logger.debug('--------------user id----------' + req.body.userId);
        const userId = req.body.userId;
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            let errorMsgs = [];
            let tempErr = errors.mapped();
            logger.debug("express validator validation error:: " + JSON.stringify(tempErr));
            for (let prop in tempErr)
                errorMsgs.push(tempErr[prop].msg);
            return res.status(400).json({ message: 'error occured', errorMsgs });
        }
        else {
            User.findById(userId, (err, result) => {
                if (err) {
                    logger.info('error occured while fetching user object');
                    return res.status(400).json({ message: 'error occured while fetching user object' })
                }
                logger.debug('user object::' + JSON.stringify(result));
                let name = result.last_name ? (result.first_name + ' ' + result.last_name) : result.first_name;
                name = name.trim();
                let user = {
                    name: name,
                    first_name: result.first_name,
                    last_name: result.last_name,
                    location: result.location,
                    bio: result.bio,
                    contact_no: result.contact_no,
                    userId: result._id,
                    email_id: result.email_id,
                    creditPoints: result.credit_points || 0,
                    profile_image_url: result.profile_image_url
                };
                res.status(200).json(user);
            })
        }
    }
]

exports.check_usename_exist = (req, res) => {
    if (req.query.username) {

        User.findOne({ username: req.query.username }, (err, result) => {
            if (err) {
                logger.info('error occured while checking username existence');
                res.status(400).json({ checkSuccess: false, message: "error occured while checking username existence" });
            }
            else if (result) {
                res.status(200).json({ checkSuccess: true, isExist: true });
            }
            else {
                res.status(200).json({ checkSuccess: true, isExist: false });
            }
        })
    }
    else {
        res.status(400).json({ checkSuccess: false, message: "username is required in request parameter" });
    }
}